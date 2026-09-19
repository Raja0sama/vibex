package tracking

import (
	"net/http"
)

// The tracking page is opened from an SMS by someone who has no account and
// never will. So this handler is deliberately unauthenticated — and therefore
// deliberately narrow: one parcel, by a number you must already know, with
// nothing in the response that is not already printed on the label.
const (
	rateLimitPerMinute = 20
	trackingNumberLen  = 16
)

func (h *Handler) Track(w http.ResponseWriter, r *http.Request) {
	number := r.PathValue("tracking_number")
	if len(number) != trackingNumberLen {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if !h.limiter.Allow(clientIP(r), rateLimitPerMinute) {
		http.Error(w, "slow down", http.StatusTooManyRequests)
		return
	}

	events, err := h.repo.EventsFor(r.Context(), number)
	if err != nil || len(events) == 0 {
		// A wrong number and an unknown number are the same answer on purpose:
		// the difference would make the number space enumerable.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, redactForPublic(events))
}
