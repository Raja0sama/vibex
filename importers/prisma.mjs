// Prisma schema → ERD spec. Regex-based, good enough for typical schemas.
import { slug, uniqueId } from './shared.mjs';

const SCALARS = new Set(['String', 'Boolean', 'Int', 'BigInt', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes', 'Unsupported']);

function parseBlocks(src) {
  const lines = src.split(/\r?\n/);
  const blocks = [];
  let current = null;
  lines.forEach((raw, i) => {
    // Strip // comments, but not inside string literals (URLs in @default, @map).
    const line = raw.replace(/("(?:[^"\\]|\\.)*")|\/\/.*$/g, (m, str) => str || '').trim();
    if (!current) {
      const m = /^(model|enum|type)\s+(\w+)\s*(?:@\w+\s*)*\{/.exec(line);
      if (m) current = { kind: m[1], name: m[2], line: i + 1, body: [] };
      return;
    }
    if (line === '}') { blocks.push(current); current = null; return; }
    if (line) current.body.push({ text: line, line: i + 1 });
  });
  return blocks;
}

function parseAttr(text, name) {
  const re = new RegExp(`@${name}(?:\\(([^)]*(?:\\([^)]*\\)[^)]*)*)\\))?`);
  const m = re.exec(text);
  return m ? { present: true, args: m[1] ?? '' } : { present: false };
}

function listOf(args, key) {
  const m = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(args);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
}

export function importPrisma(src, { title, sourcePath } = {}) {
  const blocks = parseBlocks(src);
  const models = blocks.filter((b) => b.kind === 'model' || b.kind === 'type');
  const enums = blocks.filter((b) => b.kind === 'enum');
  const modelNames = new Set(models.map((m) => m.name));
  const enumNames = new Set(enums.map((e) => e.name));
  const idOf = (name) => slug(name).toLowerCase();

  const entities = [];
  const relationships = [];
  const relIds = new Set();
  const pending = []; // implicit m:n candidates

  for (const model of models) {
    const columns = [];
    const relationFields = [];
    let tableName = model.name;
    let compositePk = [];
    for (const { text, line } of model.body) {
      if (text.startsWith('@@')) {
        const map = /@@map\("([^"]+)"\)/.exec(text); if (map) tableName = map[1];
        const id = /@@id\(\[([^\]]+)\]\)/.exec(text); if (id) compositePk = id[1].split(',').map((s) => s.trim());
        const uq = /@@unique\(\[([^\]]+)\]\)/.exec(text);
        if (uq) for (const name of uq[1].split(',').map((s) => s.trim())) { const c = columns.find((x) => x.name === name); if (c) c.unique = true; }
        continue;
      }
      const m = /^(\w+)\s+([\w.]+)(\[\])?(\?)?\s*(.*)$/.exec(text);
      if (!m) continue;
      const [, name, type, list, optional, rest] = m;
      const base = type.split('.').pop();
      if (modelNames.has(base)) { relationFields.push({ name, type: base, list: Boolean(list), optional: Boolean(optional), rest, line }); continue; }
      const col = { name, type: `${base}${list ? '[]' : ''}` };
      if (parseAttr(rest, 'id').present) col.pk = true;
      if (parseAttr(rest, 'unique').present) col.unique = true;
      if (optional) col.nullable = true;
      const def = parseAttr(rest, 'default'); if (def.present) col.default = def.args.trim();
      const map = /@map\("([^"]+)"\)/.exec(rest); if (map) col.note = `column ${map[1]}`;
      if (enumNames.has(base)) col.type = `${base}${list ? '[]' : ''}`;
      columns.push(col);
    }
    for (const name of compositePk) { const c = columns.find((x) => x.name === name); if (c) c.pk = true; }
    const entityId = idOf(model.name);
    entities.push({
      id: entityId,
      name: tableName,
      kind: model.kind === 'type' ? 'embedded' : 'table',
      columns,
      ...(sourcePath ? { sources: [{ path: sourcePath, line: model.line, label: `model ${model.name}` }] } : {}),
    });
    for (const rf of relationFields) {
      const rel = parseAttr(rf.rest, 'relation');
      const fields = rel.present ? listOf(rel.args, 'fields') : null;
      const references = rel.present ? listOf(rel.args, 'references') : null;
      if (fields && references) {
        const targetId = idOf(rf.type);
        fields.forEach((f, k) => { const c = columns.find((x) => x.name === f); if (c) c.fk = `${targetId}.${references[k] || references[0]}`; });
        const fkCol = columns.find((x) => x.name === fields[0]);
        const onDelete = /onDelete\s*:\s*(\w+)/.exec(rel.args);
        relationships.push({
          id: uniqueId(slug(`${entityId}-${rf.name}`).toLowerCase(), relIds),
          from: entityId,
          to: targetId,
          from_cardinality: fkCol?.unique || fkCol?.pk && columns.filter((c) => c.pk).length === 1 ? (fkCol?.nullable ? 'zero-or-one' : 'one') : 'many',
          to_cardinality: rf.optional ? 'zero-or-one' : 'one',
          from_column: fields.join(', '),
          to_column: references.join(', '),
          label: rf.name,
          ...(onDelete ? { on_delete: onDelete[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() } : {}),
        });
      } else if (rf.list) {
        pending.push({ from: model.name, to: rf.type, field: rf.name, line: rf.line });
      }
    }
  }
  // Implicit many-to-many: both sides are lists with no explicit relation.
  const seenPairs = new Set();
  for (const a of pending) {
    const back = pending.find((b) => b.from === a.to && b.to === a.from);
    const key = [a.from, a.to].sort().join('|');
    if (!back || seenPairs.has(key)) continue;
    seenPairs.add(key);
    relationships.push({
      id: uniqueId(slug(`${idOf(a.from)}-${idOf(a.to)}-mn`).toLowerCase(), relIds),
      from: idOf(a.from),
      to: idOf(a.to),
      from_cardinality: 'many',
      to_cardinality: 'many',
      label: `${a.field} / ${back.field} (implicit m:n)`,
    });
  }
  for (const e of enums) {
    entities.push({
      id: idOf(e.name),
      name: e.name,
      kind: 'enum',
      values: e.body.filter((l) => !l.text.startsWith('@@')).map((l) => l.text.split(/\s+/)[0]),
      ...(sourcePath ? { sources: [{ path: sourcePath, line: e.line, label: `enum ${e.name}` }] } : {}),
    });
  }
  return {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: title || 'Prisma schema', subtitle: `${models.length} models, ${enums.length} enums` },
    entities,
    relationships,
    ...(sourcePath ? { cards: [{ title: 'Source', tone: 'info', items: [`Imported from ${sourcePath}`, 'Cardinality: FK side = many unless the FK column is @unique'] }] } : {}),
  };
}
