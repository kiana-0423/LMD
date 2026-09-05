import { Modal, type ModalProps } from "antd";
import PagedContent from "./PagedContent";

export default function PagedModal({ children, styles, ...props }: ModalProps) {
  return (
    <Modal
      {...props}
      centered
      styles={{
        ...styles,
        content: { ...styles?.content, display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 32px)" },
        header: { ...styles?.header, flexShrink: 0 },
        footer: { ...styles?.footer, flexShrink: 0 },
        body: { height: "min(60vh, 640px)", ...styles?.body, minHeight: 0, overflow: "clip" }
      }}
    >
      <PagedContent>{children}</PagedContent>
    </Modal>
  );
}
