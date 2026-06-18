import { Button, Card, Descriptions, Modal, Space, Tabs, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import PageHeader from "../../components/PageHeader";
import { deleteAdditive, deleteBaseOil, listAdditives, listBaseOils } from "../../lib/api";
import { additiveFunctionLabels } from "../../lib/constants";
import type { Additive, BaseOil } from "../../types";

export default function BaseAdditiveLibraryPage() {
  const [baseOils, setBaseOils] = useState<BaseOil[]>([]);
  const [additives, setAdditives] = useState<Additive[]>([]);
  const [activeTab, setActiveTab] = useState<"base-oils" | "additives">("base-oils");
  const [selectedBaseOil, setSelectedBaseOil] = useState<BaseOil>();
  const [selectedAdditive, setSelectedAdditive] = useState<Additive>();

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    setBaseOils(await listBaseOils());
    setAdditives(await listAdditives());
  }

  const baseOilColumns: ColumnsType<BaseOil> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: "名称类型",
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.name}</span>
          <Tag>{row.baseOilType}</Tag>
        </Space>
      )
    },
    { title: "代表分子", dataIndex: "representativeMoleculeId", render: (value) => value || "-" },
    {
      title: "操作",
      width: 210,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelectedBaseOil(row)}>查看</Button>
          <Button size="small" onClick={() => message.info("编辑基础油功能将在下一阶段接入表单。")}>编辑</Button>
          <Button size="small" danger onClick={() => confirmDeleteBaseOil(row)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  const additiveColumns: ColumnsType<Additive> = [
    { title: "ID", dataIndex: "id", width: 140 },
    {
      title: "名称类型",
      render: (_, row) => (
        <Space size={6} wrap>
          <span>{row.moleculeName}</span>
          {row.functionTypes.map((value) => <Tag key={value}>{additiveFunctionLabels[value] ?? value}</Tag>)}
        </Space>
      )
    },
    { title: "代表分子", dataIndex: "moleculeId" },
    {
      title: "操作",
      width: 210,
      render: (_, row) => (
        <Space size={6}>
          <Button size="small" onClick={() => setSelectedAdditive(row)}>查看</Button>
          <Button size="small" onClick={() => message.info("编辑添加剂功能将在下一阶段接入表单。")}>编辑</Button>
          <Button size="small" danger onClick={() => confirmDeleteAdditive(row)}>
            删除
          </Button>
        </Space>
      )
    }
  ];

  function confirmDeleteBaseOil(row: BaseOil) {
    Modal.confirm({
      title: "确认删除基础油？",
      content: row.name,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const result = await deleteBaseOil(row.id);
        if (!result.success && !result.deleted) {
          message.warning("未找到需要删除的基础油记录。");
          return;
        }
        await refresh();
        if (selectedBaseOil?.id === row.id) setSelectedBaseOil(undefined);
        message.success("已从数据源删除。");
      }
    });
  }

  function confirmDeleteAdditive(row: Additive) {
    Modal.confirm({
      title: "确认删除添加剂？",
      content: row.moleculeName,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const result = await deleteAdditive(row.id);
        if (!result.success && !result.deleted) {
          message.warning("未找到需要删除的添加剂记录。");
          return;
        }
        await refresh();
        if (selectedAdditive?.id === row.id) setSelectedAdditive(undefined);
        message.success("已从数据源删除。");
      }
    });
  }

  return (
    <div className="page-grid table-page">
      <PageHeader
        title="基础油/添加剂库"
        description="管理可能没有 SMILES 的基础油，以及与分子库记录关联的添加剂。"
        extra={
          <Space wrap>
            <Button type="primary">新建基础油/添加剂</Button>
          </Space>
        }
      />
      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key as "base-oils" | "additives")}
          items={[
            {
              key: "base-oils",
              label: "基础油",
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  columns={baseOilColumns}
                  dataSource={baseOils}
                  tableLayout="fixed"
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                />
              )
            },
            {
              key: "additives",
              label: "添加剂",
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  columns={additiveColumns}
                  dataSource={additives}
                  tableLayout="fixed"
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                />
              )
            }
          ]}
        />
      </Card>
      <Modal
        width={760}
        title="基础油完整数据"
        open={Boolean(selectedBaseOil)}
        onCancel={() => setSelectedBaseOil(undefined)}
        footer={<Button type="primary" onClick={() => setSelectedBaseOil(undefined)}>关闭</Button>}
      >
        {selectedBaseOil && <BaseOilDetails item={selectedBaseOil} />}
      </Modal>
      <Modal
        width={760}
        title="添加剂完整数据"
        open={Boolean(selectedAdditive)}
        onCancel={() => setSelectedAdditive(undefined)}
        footer={<Button type="primary" onClick={() => setSelectedAdditive(undefined)}>关闭</Button>}
      >
        {selectedAdditive && <AdditiveDetails item={selectedAdditive} />}
      </Modal>
    </div>
  );
}

function BaseOilDetails({ item }: { item: BaseOil }) {
  return (
    <Card size="small" title={`${item.id} · ${item.name}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label="名称类型">{item.name} / {item.baseOilType}</Descriptions.Item>
        <Descriptions.Item label="代表分子">{item.representativeMoleculeId || "-"}</Descriptions.Item>
        <Descriptions.Item label="供应商">{item.supplier || "-"}</Descriptions.Item>
        <Descriptions.Item label="40C 黏度">{item.viscosity40c ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="100C 黏度">{item.viscosity100c ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="黏度指数">{item.viscosityIndex ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="密度">{item.density ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="倾点">{item.pourPoint ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="闪点">{item.flashPoint ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="批次">{item.batchNumber || "-"}</Descriptions.Item>
        <Descriptions.Item label="配方数量">{item.formulationCount}</Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>{item.notes || "-"}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{item.updatedAt}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

function AdditiveDetails({ item }: { item: Additive }) {
  return (
    <Card size="small" title={`${item.id} · ${item.moleculeName}`} className="detail-data-card">
      <Descriptions size="small" bordered column={2}>
        <Descriptions.Item label="ID">{item.id}</Descriptions.Item>
        <Descriptions.Item label="名称类型">
          <Space size={4} wrap>
            <span>{item.moleculeName}</span>
            {item.functionTypes.map((value) => <Tag key={value}>{additiveFunctionLabels[value] ?? value}</Tag>)}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="代表分子">{item.moleculeId}</Descriptions.Item>
        <Descriptions.Item label="活性元素">{item.activeElements.join(", ") || "-"}</Descriptions.Item>
        <Descriptions.Item label="典型浓度">
          {item.typicalConcentrationMin}-{item.typicalConcentrationMax} {item.concentrationUnit}
        </Descriptions.Item>
        <Descriptions.Item label="兼容基础油">{item.compatibleBaseOils.join(", ") || "-"}</Descriptions.Item>
        <Descriptions.Item label="配方数量">{item.formulationCount}</Descriptions.Item>
        <Descriptions.Item label="最佳摩擦系数">{item.bestFrictionCoefficient ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="最佳磨斑直径">{item.bestWearScarDiameter ?? "-"}</Descriptions.Item>
        <Descriptions.Item label="应用说明" span={2}>{item.applicationNotes || "-"}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{item.createdAt}</Descriptions.Item>
        <Descriptions.Item label="更新时间">{item.updatedAt}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
