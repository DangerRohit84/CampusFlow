import toast from 'react-hot-toast'

/**
 * Success toast with an Undo action for destructive operations.
 * WHY: deletes must be recoverable without a support ticket — the caller
 * passes a re-create callback that restores the deleted snapshot.
 * Usage:
 *   const snapshot = { ...task }
 *   await taskAPI.delete(task.id)
 *   setTasks(prev => prev.filter(t => t.id !== task.id))
 *   showUndoToast('Task deleted', async () => {
 *     const restored = await taskAPI.create(snapshot)
 *     setTasks(prev => [restored, ...prev])
 *   })
 */
export function showUndoToast(message: string, onUndo: () => void | Promise<void>) {
  toast(
    (t) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{message}</span>
        <button
          type="button"
          aria-label={`Undo: ${message}`}
          onClick={async () => {
            toast.dismiss(t.id)
            try {
              await onUndo()
              toast.success('Restored')
            } catch {
              toast.error('Could not undo — please re-create manually')
            }
          }}
          style={{
            padding: '0 14px',
            minHeight: 44,
            minWidth: 44,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            background: '#fff',
            color: '#121212',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            border: 'none',
          }}
        >
          Undo
        </button>
      </span>
    ),
    { duration: 6000 },
  )
}
