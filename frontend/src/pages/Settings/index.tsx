/**
 * 系统设置页面
 */

import React, { useState, useEffect } from 'react';
import { Card, Form, Select, InputNumber, Button, Spin, message, Divider, Table, Modal, Input, Tag, Space, Tooltip } from 'antd';
import { SaveOutlined, PlusOutlined, DeleteOutlined, InfoCircleOutlined, ThunderboltOutlined, EditOutlined } from '@ant-design/icons';
import { PageHeader } from '@/components/common';
import { getSettings, updateSettings, getModelList, createCustomModel, updateCustomModel, deleteCustomModel, getCustomModels, testCustomModel } from '@/services';
import { useAppStore } from '@/stores';
import type { SystemSettings, UpdateSettingsRequest, CustomModel } from '@/types';
import styles from './Settings.module.css';

const Settings: React.FC = () => {
  const { models, setModels } = useAppStore();
  const [form] = Form.useForm();
  const [modelForm] = Form.useForm();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null); // 正在测试的模型 ID
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  
  // 自定义模型相关状态
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [creatingModel, setCreatingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);

  // 加载数据
  const loadData = async () => {
    setLoading(true);
    try {
      const [settingsRes, modelsRes, customModelsRes] = await Promise.all([
        getSettings(),
        getModelList(),
        getCustomModels(), // 获取自定义模型列表
      ]);
      setSettings(settingsRes.data);
      setModels(modelsRes.data);
      setCustomModels(customModelsRes.data);
      
      form.setFieldsValue({
        defaultEmbeddingModel: settingsRes.data.defaultEmbeddingModel,
        defaultVlmModel: settingsRes.data.defaultVlmModel,
        defaultLlmModel: settingsRes.data.defaultLlmModel,
        maxConcurrency: settingsRes.data.maxConcurrency,
        chunkSize: settingsRes.data.chunkSize,
        chunkOverlap: settingsRes.data.chunkOverlap,
      });
    } catch (error) {
      message.error('加载设置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // 保存设置
  const handleSave = async (values: SystemSettings) => {
    setSaving(true);
    try {
      const request: UpdateSettingsRequest = {
        default_embedding_model: values.defaultEmbeddingModel,
        default_vlm_model: values.defaultVlmModel,
        default_llm_model: values.defaultLlmModel,
        max_concurrency: values.maxConcurrency,
        chunk_size: values.chunkSize,
        chunk_overlap: values.chunkOverlap,
      };
      await updateSettings(request);
      message.success('保存成功');
    } catch (error) {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 保存模型（创建或更新）
  const handleSaveModel = async (values: any) => {
    setCreatingModel(true);
    try {
      if (editingModelId) {
        await updateCustomModel(editingModelId, values);
        message.success('更新模型成功');
      } else {
        await createCustomModel(values);
        message.success('添加模型成功');
      }
      setIsModalVisible(false);
      modelForm.resetFields();
      setEditingModelId(null);
      loadData(); // 重新加载列表
    } catch (error) {
      message.error(editingModelId ? '更新模型失败' : '添加模型失败');
    } finally {
      setCreatingModel(false);
    }
  };

  // 打开添加模态框
  const handleOpenCreateModal = () => {
    setEditingModelId(null);
    modelForm.resetFields();
    setIsModalVisible(true);
  };

  // 打开编辑模态框
  const handleEditModel = (model: CustomModel) => {
    setEditingModelId(model.id);
    modelForm.setFieldsValue({
      name: model.name,
      model_type: model.model_type,
      base_url: model.base_url,
      api_key: model.api_key,
      model_name: model.model_name,
    });
    setIsModalVisible(true);
  };

  // 删除自定义模型
  const handleDeleteModel = async (id: string) => {
    try {
      await deleteCustomModel(id);
      message.success('删除成功');
      loadData(); // 重新加载
    } catch (error) {
      message.error('删除失败');
    }
  };

  // 测试自定义模型
  const handleTestModel = async (model: CustomModel) => {
    setTestingModel(model.id);
    try {
        await testCustomModel(model.id);
        message.success(`模型 ${model.name} 连接测试成功！`);
    } catch (error: any) {
        console.error("Test failed:", error);
        // 尝试提取错误信息
        const errorMsg = error.response?.data?.detail?.message || error.message || '未知错误';
        message.error(`连接测试失败: ${errorMsg}`);
    } finally {
        setTestingModel(null);
    }
  };

  // 分类模型
  const embeddingModels = models.filter((m) => m.type === 'embedding');
  const vlmModels = models.filter((m) => m.type === 'vlm');
  const llmModels = models.filter((m) => m.type === 'llm');

  const modelColumns = [
    {
      title: '显示名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'model_type',
      key: 'model_type',
      width: 100,
      render: (type: string) => <Tag color={type === 'llm' ? 'blue' : type === 'embedding' ? 'green' : 'orange'}>{type}</Tag>,
    },
    {
      title: '实际模型名',
      dataIndex: 'model_name',
      key: 'model_name',
      width: 150,
      ellipsis: true,
    },
    {
      title: 'Base URL',
      dataIndex: 'base_url',
      key: 'base_url',
      ellipsis: {
        showTitle: false,
      },
      render: (url: string) => (
        <Tooltip title={url}>
          {url}
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right' as const,
      render: (_: any, record: CustomModel) => (
        <Space>
            <Button
                type="link"
                icon={<EditOutlined />}
                onClick={() => handleEditModel(record)}
            >
                编辑
            </Button>
            <Button
                type="link"
                icon={<ThunderboltOutlined />}
                loading={testingModel === record.id}
                onClick={() => handleTestModel(record)}
            >
                测试
            </Button>
            <Button 
            type="text" 
            danger 
            icon={<DeleteOutlined />} 
            onClick={() => handleDeleteModel(record.id)}
            >
            删除
            </Button>
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title="系统设置"
        subtitle="配置系统参数和模型选项"
      />

      <div className={styles.content}>
        {/* 自定义模型管理 (全宽) */}
        <div className={styles.fullPanel}>
          <Card 
            title="自定义模型管理" 
            className={styles.card}
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleOpenCreateModal}>
                添加模型
              </Button>
            }
          >
            <Table 
              dataSource={customModels} 
              columns={modelColumns} 
              rowKey="id"
              pagination={false}
              size="middle"
              scroll={{ x: true }}
            />
          </Card>
        </div>
      </div>

      {/* 添加/编辑模型弹窗 */}
      <Modal
        title={editingModelId ? "编辑自定义模型" : "添加自定义模型"}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
      >
        <Form
          form={modelForm}
          layout="vertical"
          onFinish={handleSaveModel}
        >
          <Form.Item
            name="name"
            label="显示名称"
            rules={[{ required: true, message: '请输入显示名称' }]}
            tooltip="在界面上下拉框中显示的名称"
          >
            <Input placeholder="例如: My DeepSeek" />
          </Form.Item>

          <Form.Item
            name="model_type"
            label="模型类型"
            rules={[{ required: true, message: '请选择模型类型' }]}
          >
            <Select>
              <Select.Option value="llm">大语言模型 (LLM)</Select.Option>
              <Select.Option value="embedding">向量模型 (Embedding)</Select.Option>
              <Select.Option value="vlm">视觉模型 (VLM)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="base_url"
            label="API Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }]}
            tooltip="例如: https://api.deepseek.com/v1"
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>

          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="sk-..." />
          </Form.Item>

          <Form.Item
            name="model_name"
            label="实际模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
            tooltip="API 调用时使用的 model 参数值，例如: deepseek-chat"
          >
            <Input placeholder="gpt-3.5-turbo" />
          </Form.Item>

          <Form.Item>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={() => setIsModalVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={creatingModel}>
                {editingModelId ? "更新" : "添加"}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default Settings;
