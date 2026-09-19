package relay;

import java.util.Map;
import java.util.Set;

/**
 * The only thing that moves a parcel forward is a scan. There is no manual
 * status edit anywhere in Relay, and this table is the reason: a status that
 * could be set by hand could not be trusted to mean a parcel was physically
 * somewhere.
 */
public final class ParcelStateMachine {

    private static final Map<Status, Set<Status>> ALLOWED = Map.of(
        Status.CREATED, Set.of(Status.COLLECTED, Status.CANCELLED),
        Status.COLLECTED, Set.of(Status.AT_DEPOT),
        Status.AT_DEPOT, Set.of(Status.IN_TRANSIT, Status.OUT_FOR_DELIVERY, Status.LOST),
        Status.IN_TRANSIT, Set.of(Status.AT_DEPOT, Status.LOST),
        Status.OUT_FOR_DELIVERY, Set.of(Status.DELIVERED, Status.ATTEMPT_FAILED),
        Status.ATTEMPT_FAILED, Set.of(Status.OUT_FOR_DELIVERY, Status.AWAITING_INSTRUCTION),
        Status.AWAITING_INSTRUCTION, Set.of(Status.OUT_FOR_DELIVERY, Status.RETURNING),
        Status.RETURNING, Set.of(Status.RETURNED),
        Status.LOST, Set.of(Status.AT_DEPOT)
    );

    public boolean permits(Status from, Status to) {
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }

    /**
     * Scans arrive out of order from offline handhelds, so a scan can describe a
     * step the parcel has already moved past. Such a scan is still recorded --
     * the history must be complete -- but it does not move the status backwards.
     */
    public Status apply(Status current, Scan scan) {
        Status proposed = scan.impliedStatus();
        if (!permits(current, proposed)) {
            return current;
        }
        return proposed;
    }
}
