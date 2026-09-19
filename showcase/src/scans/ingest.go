package scans

import (
	"context"
	"time"
)

// A handheld can be offline for hours. When it finds signal it uploads
// everything it has, so a batch may contain scans taken before ones we already
// hold, and the same batch may arrive twice if the upload times out.
//
// Both are handled here rather than in dispatch: the ingest boundary is the
// only place that knows about devices.
type Batch struct {
	DeviceID string
	Scans    []Scan
}

type Scan struct {
	ParcelID       string
	Type           string
	ScannedAt      time.Time // device clock; may be wrong
	IdempotencyKey string    // device id + monotonic counter, stable across retries
}

// Ingest writes every scan exactly once. The unique index on idempotency_key is
// what enforces it — a duplicate upload loses the race and is discarded, so the
// same batch can be replayed any number of times without changing anything.
func (s *Service) Ingest(ctx context.Context, b Batch) (Result, error) {
	var res Result
	for _, scan := range b.Scans {
		inserted, err := s.repo.InsertIfNew(ctx, scan)
		if err != nil {
			return res, err
		}
		if !inserted {
			res.Duplicates++
			continue
		}
		res.Accepted++
		// Ordering is decided downstream by scanned_at, not by arrival, so a
		// late scan is published the same way as a fresh one.
		if err := s.events.Publish(ctx, "parcel.scanned", scan); err != nil {
			return res, err
		}
	}
	return res, nil
}
