package shipments

import (
	"errors"
	"net/http"
)

var ErrAlreadyMoving = errors.New("a parcel in this shipment has already been scanned")

// Cancellation is only honest before Relay has physically taken the parcel.
// After the first scan the parcel exists in the network and has to come back
// through it, which is a return, not a cancellation, and is charged as one.
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	scanned, err := h.repo.AnyParcelScanned(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	if scanned {
		http.Error(w, ErrAlreadyMoving.Error(), http.StatusConflict)
		return
	}

	shipment, err := h.repo.Cancel(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, shipment)
}
