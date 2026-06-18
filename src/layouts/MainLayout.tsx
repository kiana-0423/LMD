import {
  BarChartOutlined,
  BuildOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileAddOutlined,
  EditOutlined,
  HomeOutlined,
  LineChartOutlined,
  PartitionOutlined,
  ProfileOutlined,
  SettingOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { Layout, Menu, Space, Tag, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { APP_NAME, APP_NAME_CN } from "../lib/constants";

const { Header, Sider, Content, Footer } = Layout;

const menuItems = [
  {
    key: "dashboard-group",
    label: "仪表盘",
    type: "group" as const,
    children: [{ key: "/dashboard", label: "仪表盘", icon: <HomeOutlined /> }]
  },
  {
    key: "database-group",
    label: "数据库",
    type: "group" as const,
    children: [
      { key: "/molecules", label: "分子库", icon: <DatabaseOutlined /> },
      { key: "/base-additive", label: "基础油/添加剂库", icon: <BuildOutlined /> },
      { key: "/formulations", label: "配方库", icon: <PartitionOutlined /> },
      { key: "/experiments", label: "实验与性能", icon: <ExperimentOutlined /> }
    ]
  },
  {
    key: "input-group",
    label: "录入",
    type: "group" as const,
    children: [
      { key: "/molecule-entry", label: "分子录入", icon: <FileAddOutlined /> },
      { key: "/molecule-sketcher", label: "分子绘画", icon: <EditOutlined /> },
      { key: "/formulation-entry", label: "配方录入", icon: <ProfileOutlined /> }
    ]
  },
  {
    key: "tools-group",
    label: "工具",
    type: "group" as const,
    children: [
      { key: "/descriptors", label: "描述符中心", icon: <BarChartOutlined /> },
      { key: "/analysis-design", label: "数据分析/智能设计", icon: <LineChartOutlined /> }
    ]
  },
  {
    key: "system-group",
    label: "系统",
    type: "group" as const,
    children: [
      { key: "import-export", label: "导入/导出", icon: <UploadOutlined />, disabled: true },
      { key: "settings", label: "设置", icon: <SettingOutlined />, disabled: true }
    ]
  }
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout className="main-layout">
      <Sider
        width={288}
        collapsedWidth={72}
        breakpoint="lg"
        collapsible
        trigger={null}
        className="app-sider"
      >
        <div className="brand-block">
          <div className="brand-mark">LMD</div>
          <div>
            <Typography.Text className="brand-title">{APP_NAME}</Typography.Text>
            <Typography.Text className="brand-subtitle">{APP_NAME_CN}</Typography.Text>
          </div>
        </div>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => {
            if (String(key).startsWith("/")) navigate(String(key));
          }}
        />
      </Sider>
      <Layout className="app-main">
        <Header className="app-header">
          <div>
            <Typography.Title level={4}>{APP_NAME}</Typography.Title>
            <Typography.Text type="secondary">本地润滑材料数据库与智能设计 MVP</Typography.Text>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
        <Footer className="status-footer">
          <Space size="middle" wrap>
            <span>工作区：LMD_Workspace</span>
            <Tag color="green">SQLite 就绪</Tag>
            <Tag color="gold">Python Sidecar 模拟模式</Tag>
          </Space>
        </Footer>
      </Layout>
    </Layout>
  );
}
