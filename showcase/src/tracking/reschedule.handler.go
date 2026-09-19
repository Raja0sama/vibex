package tracking

import (
	"net/http"
)

// Rescheduling and redirecting both change where a parcel physically goes, so
// neither is allowed on the tracking number alone. The number is printed on the
// box and has been seen by everyone who handled it; a code texted to the phone
// on the shipment is the only thing tying the request to the recipient.
func (h *Handler) Reschedule(w http.ResponseWriter, r *http.Request) {
	number := r.PathValue("tracking_number")

	var input RescheduleInput
	if err := readJSON(r, &input); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if !h.otp.Verify(r.Context(), number, input.OTP) {
		http.Error(w, "gone", http.StatusGone)
		return
	}

	parcel, err := h.repo.ByTrackingNumber(r.Context(), number)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	// Once the van is loaded and sequenced for the day, the parcel is committed
	// to that route. Changing it now would leave a stop the driver still has.
	if parcel.Status == StatusOutForDelivery {
		http.Error(w, "already on a van today", http.StatusConflict)
		return
	}

	event, err := h.dispatch.Reschedule(r.Context(), parcel.ID, input.ServiceDate)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, event)
}
