package relay;

/**
 * How many times a van will try a door before the parcel stops moving.
 *
 * Two, then stop. The scarce resource in this network is van time, not shelf
 * space at a depot, so a third speculative attempt costs more than holding the
 * parcel until a human tells us something new.
 */
public final class AttemptPolicy {

    public static final int MAX_ATTEMPTS = 2;
    public static final int DAYS_AWAITING_INSTRUCTION = 5;

    private AttemptPolicy() {}

    public static boolean shouldRetryTomorrow(int attemptsUsed) {
        return attemptsUsed < MAX_ATTEMPTS;
    }

    public static boolean shouldStartReturn(int attemptsUsed, int daysWaiting) {
        return attemptsUsed >= MAX_ATTEMPTS && daysWaiting >= DAYS_AWAITING_INSTRUCTION;
    }
}
