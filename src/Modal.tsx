import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native modal semantics keep background content inert and contain keyboard focus. */
export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal-card native-modal ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}

type Decision = "save" | "discard" | "cancel";
export function useSaveDecision() {
  const [prompt, setPrompt] = useState<{
    names: string;
    resolve: (d: Decision) => void;
  } | null>(null);
  const pending = useRef(false);
  function decide(names: string): Promise<Decision> {
    if (pending.current) return Promise.resolve("cancel");
    pending.current = true;
    return new Promise((resolve) => setPrompt({ names, resolve }));
  }
  function finish(result: Decision) {
    prompt?.resolve(result);
    pending.current = false;
    setPrompt(null);
  }
  const dialog = prompt && (
    <Modal
      title="Save changes?"
      onClose={() => finish("cancel")}
      className="save-dialog"
    >
      <header className="modal-head">
        <h2>Save changes before closing?</h2>
      </header>
      <div className="modal-body">
        <p>Your changes to {prompt.names} haven’t been saved.</p>
      </div>
      <footer className="dialog-actions">
        <button onClick={() => finish("discard")}>Don’t Save</button>
        <span className="spacer" />
        <button data-autofocus onClick={() => finish("cancel")}>
          Cancel
        </button>
        <button className="primary-action" onClick={() => finish("save")}>
          Save
        </button>
      </footer>
    </Modal>
  );
  return { decide, dialog };
}
