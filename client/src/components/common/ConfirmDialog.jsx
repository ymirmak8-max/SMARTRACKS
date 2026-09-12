const ConfirmDialog = ({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm, onCancel }) => {
  if (!open) return null;

  return (
    <div className="modal-overlay confirm-dialog-overlay" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onCancel?.();
    }}>
      <section className="modal-content confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <div className="modal-handle" />
        <h2 className="modal-title" id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-message">{message}</p>
        <div className="modal-actions confirm-dialog-actions">
          <button type="button" className="action-btn action-btn-gray" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className={danger ? 'action-btn confirm-danger-button' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
};

export default ConfirmDialog;
