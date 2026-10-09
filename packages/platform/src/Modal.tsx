import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** A small native-dialog adapter; the browser provides focus containment and Escape. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, []);
  return (
    <dialog ref={ref} aria-label={title} onCancel={onClose}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
