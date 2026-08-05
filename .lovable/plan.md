# Fix property deletion flow

## Diagnosis

Clicking **Delete** closes the edit dialog by clearing `editTarget`. Because the confirmation dialog is rendered inside that same conditionally mounted `PropertyDialog`, it is unmounted before its delayed open state can run. This is why the window simply disappears.

## Implementation

1. Lift the pending-delete property and confirmation state to the `AdminProperties` page so the confirmation dialog remains mounted after the edit dialog closes.
2. Open the parent-level confirmation directly from the edit dialog’s Delete button, preserving the selected property and required slug confirmation.
3. Harden the deletion routine to check every related-record deletion for errors, keep the confirmation visible when deletion fails, and only remove the property from the list after the database confirms success.
4. Keep controls disabled while deletion is running and show clear success or failure feedback.

## Verification

- Open a property, click **Delete**, and confirm the destructive confirmation stays visible and accepts interaction.
- Verify cancel leaves the property unchanged.
- Verify an incorrect slug cannot submit.
- Verify a correct slug deletes the property, refreshes the list, and closes the confirmation only after success.
- Confirm there are no dialog ref/accessibility warnings introduced by the updated flow.