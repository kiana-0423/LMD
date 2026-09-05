import { Drawer, type DrawerProps } from "antd";
import PagedContent from "./PagedContent";

export default function PagedDrawer({ children, styles, ...props }: DrawerProps) {
  return (
    <Drawer {...props} styles={{ ...styles, body: { ...styles?.body, overflow: "clip" } }}>
      <PagedContent>{children}</PagedContent>
    </Drawer>
  );
}
