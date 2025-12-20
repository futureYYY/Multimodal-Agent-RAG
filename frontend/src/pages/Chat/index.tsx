/**
 * 智能对话页面
 */

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, Select, Button, Input, Spin, Collapse, Tag, message, Segmented, Slider, Divider, Space, Tooltip, Modal } from 'antd';
import {
  SendOutlined,
  StopOutlined,
  EditOutlined,
  ReloadOutlined,
  LinkOutlined,
  RobotOutlined,
  MessageOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { PageHeader, MarkdownRenderer, EmptyState } from '@/components/common';
import { getKnowledgeBaseList, getModelList, rewriteQuery, createChatStream } from '@/services';
import { useAppStore, useChatStore } from '@/stores';
import type { ChatMessage, AgentStep, Citation, KnowledgeBase, ModelInfo } from '@/types';
import styles from './Chat.module.css';

const { Panel } = Collapse;

interface ChatConfig {
  kbIds: string[];
  topK: number;
  scoreThreshold: number;
}

const Chat: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlKbId = searchParams.get('kb_id');

  const { knowledgeBases, setKnowledgeBases, models, setModels } = useAppStore();
  
  // 从 store 中只解构需要的变量，避免解构 messages 等已被本地状态替代的变量
  const {
    selectedModel,
    setSelectedModel,
    isGenerating,
    setIsGenerating,
    abortController,
    setAbortController,
  } = useChatStore();

  const [inputValue, setInputValue] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // 详情弹窗状态
  const [citationModalVisible, setCitationModalVisible] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  // 模式状态
  const [chatMode, setChatMode] = useState<'normal' | 'agent'>('agent');
  
  // 独立的消息状态
  const [agentMessages, setAgentMessages] = useState<ChatMessage[]>([]);
  const [normalMessages, setNormalMessages] = useState<ChatMessage[]>([]);
  
  // 当前显示的 messages 引用
  const messages = chatMode === 'normal' ? normalMessages : agentMessages;
  
  // 包装 addMessage 和 updateMessage 以支持独立状态
  const addMessage = (msg: ChatMessage) => {
    if (chatMode === 'normal') {
      setNormalMessages(prev => [...prev, msg]);
    } else {
      setAgentMessages(prev => [...prev, msg]);
    }
  };
  
  const updateMessage = (id: string, updates: Partial<ChatMessage>) => {
    const setter = chatMode === 'normal' ? setNormalMessages : setAgentMessages;
    setter(prev => prev.map(msg => msg.id === id ? { ...msg, ...updates } : msg));
  };
  
  const clearMessages = () => {
    if (chatMode === 'normal') {
      setNormalMessages([]);
    } else {
      setAgentMessages([]);
    }
  };

  const [normalConfig, setNormalConfig] = useState<ChatConfig>({
    kbIds: [],
    topK: 3,
    scoreThreshold: 0.3,
  });

  const [agentConfig, setAgentConfig] = useState<ChatConfig>({
    kbIds: [],
    topK: 3,
    scoreThreshold: 0.3,
  });

  // 获取当前模式的配置
  const currentConfig = chatMode === 'normal' ? normalConfig : agentConfig;
  const setCurrentConfig = (newConfig: Partial<ChatConfig>) => {
    if (chatMode === 'normal') {
      setNormalConfig({ ...normalConfig, ...newConfig });
    } else {
      setAgentConfig({ ...agentConfig, ...newConfig });
    }
  };

  // 初始化加载
  useEffect(() => {
    const init = async () => {
      try {
        const [kbRes, modelRes] = await Promise.all([
          getKnowledgeBaseList(),
          getModelList(),
        ]);

        const kbData = Array.isArray(kbRes) ? kbRes : (kbRes as any).data || [];
        setKnowledgeBases(Array.isArray(kbData) ? kbData : []);

        const modelData = Array.isArray(modelRes) ? modelRes : (modelRes as any).data || [];
        setModels(Array.isArray(modelData) ? modelData : []);

        // 设置默认 LLM 模型
        const llmModels = (Array.isArray(modelData) ? modelData : []).filter((m: ModelInfo) => m.type === 'llm');
        if (llmModels.length > 0 && !selectedModel) {
          setSelectedModel(llmModels[0].id);
        }

        // URL 参数预选知识库 (仅针对当前默认模式 - Agent)
        if (urlKbId && (Array.isArray(kbData) ? kbData : []).some((kb: KnowledgeBase) => kb.id === urlKbId)) {
          setAgentConfig(prev => ({ ...prev, kbIds: [urlKbId] }));
          setNormalConfig(prev => ({ ...prev, kbIds: [urlKbId] }));
        }
      } catch (error) {
        console.error('初始化失败:', error);
      }
    };
    init();
  }, []);

  // 自动滚动到底部
  useEffect(() => {
    if (isGenerating || messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isGenerating]);


  // 处理问题改写
  const handleRewrite = async () => {
    if (!inputValue.trim()) return;

    setRewriting(true);
    try {
      const response = await rewriteQuery({ query: inputValue.trim(), model_id: selectedModel });
      setInputValue(response.data.rewritten_query);
      message.success('问题改写成功');
    } catch (error) {
      message.error('改写失败');
    } finally {
      setRewriting(false);
    }
  };

  // 生成消息 ID
  const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  // 发送消息
  const handleSend = async () => {
    if (!inputValue.trim() || isGenerating) return;

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
    };

    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: '',
      agentSteps: [],
      citations: [],
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };

    addMessage(userMessage);
    addMessage(assistantMessage);
    setInputValue('');
    setIsGenerating(true);

    let accumulatedContent = '';
    
    // 平滑输出控制
    let targetContent = ''; // 目标完整内容
    let displayContent = ''; // 当前展示内容
    let animationFrameId: number;

    const animateTypewriter = () => {
      if (displayContent.length < targetContent.length) {
        const remaining = targetContent.length - displayContent.length;
        const step = remaining > 50 ? 5 : remaining > 20 ? 2 : 1;
        
        displayContent += targetContent.slice(displayContent.length, displayContent.length + step);
        
        updateMessage(assistantMessage.id, {
          content: displayContent,
        });
        
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
        animationFrameId = requestAnimationFrame(animateTypewriter);
      }
    };

    const { abort } = createChatStream(
      {
        messages: [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        })),
        kb_ids: currentConfig.kbIds,
        stream: true,
        mode: chatMode,
        top_k: currentConfig.topK,
        score_threshold: currentConfig.scoreThreshold,
        model_id: selectedModel,
      },
      {
          onAgentThought: (data) => {
            const step: AgentStep = {
              type: data.step,
              content: data.content,
              timestamp: new Date().toISOString(),
            };
            
            // 获取当前最新的消息列表
            // 注意：这里不能直接用 messages 闭包，需要用 setXxx 的回调或者 ref
            // 但为了简单，我们重新实现 updateMessage 的逻辑
            const setter = chatMode === 'normal' ? setNormalMessages : setAgentMessages;
            setter(prev => {
                const msgs = [...prev];
                const msgIndex = msgs.findIndex(m => m.id === assistantMessage.id);
                if (msgIndex > -1) {
                    const msg = { ...msgs[msgIndex] };
                    msg.agentSteps = [...(msg.agentSteps || []), step];
                    msgs[msgIndex] = msg;
                }
                return msgs;
            });
          },
          onRagResult: (data) => {
             // 同样的逻辑更新 citations
            const setter = chatMode === 'normal' ? setNormalMessages : setAgentMessages;
            setter(prev => {
                const msgs = [...prev];
                const msgIndex = msgs.findIndex(m => m.id === assistantMessage.id);
                if (msgIndex > -1) {
                    msgs[msgIndex] = { ...msgs[msgIndex], citations: data.citations };
                }
                return msgs;
            });
          },
        onAnswerChunk: (data) => {
          accumulatedContent += data.content;
          targetContent = accumulatedContent;
          
          if (displayContent.length === targetContent.length - data.content.length) {
             animateTypewriter();
          }
        },
        onDone: () => {
          const finish = () => {
             updateMessage(assistantMessage.id, {
               content: accumulatedContent,
               isStreaming: false,
             });
             setIsGenerating(false);
             setAbortController(null);
             cancelAnimationFrame(animationFrameId);
          };

          if (targetContent.length - displayContent.length < 10) {
             setTimeout(finish, 200);
          } else {
             finish();
          }
        },
        onError: (error) => {
          cancelAnimationFrame(animationFrameId);
          updateMessage(assistantMessage.id, {
            content: '发生错误，请重试',
            error: error.message,
            isStreaming: false,
            // 即使出错，如果有引用，也保留引用
            // citations: useChatStore.getState().messages.find(m => m.id === assistantMessage.id)?.citations || [],
          });
          setIsGenerating(false);
          setAbortController(null);
        },
      }
    );

    setAbortController(() => abort);
  };

  // 停止生成
  const handleStop = () => {
    abortController?.();
    setIsGenerating(false);
    setAbortController(null);
  };

  // 重试
  const handleRetry = () => {
    if (messages.length < 2) return;
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMessage) {
      setInputValue(lastUserMessage.content);
      clearMessages();
      messages.slice(0, -2).forEach((m) => addMessage(m));
    }
  };

  // 渲染 Agent 思考步骤
  const renderAgentSteps = (steps: AgentStep[]) => {
    const stepLabels: Record<string, string> = {
      thinking: '分析意图',
      decision: '判定检索',
      action: '调用工具',
      response: '生成回复',
    };

    return (
      <Collapse ghost className={styles.agentSteps}>
        <Panel header="思考过程" key="steps">
          <div className={styles.stepList}>
            {steps.map((step, index) => (
              <div key={index} className={styles.stepItem}>
                <Tag color="blue">{stepLabels[step.type] || step.type}</Tag>
                <span className={styles.stepContent}>{step.content}</span>
              </div>
            ))}
          </div>
        </Panel>
      </Collapse>
    );
  };

  // 渲染引用来源
  const renderCitations = (citations: Citation[]) => {
    if (citations.length === 0) return null;

    return (
      <Collapse ghost className={styles.citations}>
        <Panel
          header={`参考来源 (${citations.length})`}
          key="citations"
          extra={<LinkOutlined />}
        >
          <div className={styles.citationList}>
            {citations.map((citation, index) => (
              <div key={index} className={styles.citationItem}>
                <div className={styles.citationHeader}>
                  <Tag color="orange">{citation.kb_name || '未知知识库'}</Tag>
                  <Tooltip title={citation.fileId ? "点击查看文件详情" : "文件 ID 未知"}>
                      <Tag 
                        color="blue" 
                        style={{ cursor: citation.fileId ? 'pointer' : 'default' }}
                        onClick={() => {
                            if (citation.fileId && citation.kb_id) {
                                // 新窗口打开或者跳转
                                // navigate(`/kb/${citation.kb_id}/preview/${citation.fileId}`);
                                window.open(`/kb/${citation.kb_id}/preview/${citation.fileId}`, '_blank');
                            } else if (citation.fileId && currentConfig.kbIds.length === 1) {
                                // 如果 citation 没有 kb_id 但当前只选了一个知识库，尝试使用当前知识库
                                window.open(`/kb/${currentConfig.kbIds[0]}/preview/${citation.fileId}`, '_blank');
                            }
                        }}
                      >
                        {citation.fileName || '未知文件'}
                      </Tag>
                  </Tooltip>
                  <Tag>{citation.location || '未知位置'}</Tag>
                  <Tag color="green">相似度: {citation.score.toFixed(3)}</Tag>
                </div>
                {citation.content && (
                  <div 
                    className={styles.citationContent}
                    onClick={() => {
                        setSelectedCitation(citation);
                        setCitationModalVisible(true);
                    }}
                    style={{ cursor: 'pointer' }}
                    title="点击查看完整内容"
                  >
                    {citation.image_path ? (
                        <div style={{ textAlign: 'center' }}>
                            <img 
                                src={`http://localhost:8000/static/images/${citation.image_path}`} 
                                alt="引用图片" 
                                style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain' }}
                            />
                        </div>
                    ) : (
                        // 修改：不截断内容，由 CSS 控制高度
                        <div style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                        }}>
                            {citation.content}
                        </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </Collapse>
    );
  };

  // 渲染消息
  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === 'user';

    return (
      <div
        key={msg.id}
        className={`${styles.messageWrapper} ${isUser ? styles.userMessage : styles.assistantMessage}`}
      >
        <div className={styles.messageContent}>
          {!isUser && msg.agentSteps && msg.agentSteps.length > 0 && (
            renderAgentSteps(msg.agentSteps)
          )}

          <div className={styles.messageBubble}>
            {msg.isStreaming && !msg.content ? (
              <div className={styles.thinking}>
                <Spin size="small" />
                <span>思考中...</span>
              </div>
            ) : msg.error ? (
              <div className={styles.error}>
                <span>{msg.content}</span>
                <Button
                  type="link"
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={handleRetry}
                >
                  重试
                </Button>
              </div>
            ) : (
              msg.content && <MarkdownRenderer content={msg.content} />
            )}
          </div>

          {!isUser && msg.citations && renderCitations(msg.citations)}
        </div>
      </div>
    );
  };

  const chatModels = (models || []).filter((m) => m.type === 'llm' || m.type === 'vlm');

  return (
    <div className={styles.container}>
      <PageHeader
        title="智能对话"
        subtitle="基于知识库的智能问答"
        extra={
          <Segmented
            value={chatMode}
            onChange={(value) => setChatMode(value as 'normal' | 'agent')}
            options={[
              { label: 'Agent 模式', value: 'agent', icon: <RobotOutlined /> },
              { label: '普通模式', value: 'normal', icon: <MessageOutlined /> },
            ]}
          />
        }
      />

      {/* 配置区 */}
      <Card className={styles.configCard}>
        <div className={styles.configRow}>
          {chatMode === 'normal' && (
            <div className={styles.configItem}>
              <label>知识库</label>
              <Select
                mode="multiple"
                placeholder="选择知识库（可多选）"
                value={currentConfig.kbIds}
                onChange={(val) => setCurrentConfig({ kbIds: val })}
                style={{ width: 300 }}
                options={knowledgeBases.map((kb) => ({
                  value: kb.id,
                  label: kb.name,
                }))}
              />
            </div>
          )}
          
          <div className={styles.configItem}>
            <label>模型</label>
            <Select
              placeholder="选择 LLM 模型"
              value={selectedModel}
              onChange={setSelectedModel}
              style={{ width: 200 }}
              options={(chatModels || []).map((m) => ({
                value: m.id,
                label: m.name,
              }))}
            />
          </div>
          
          <Divider type="vertical" />
          
          <div className={styles.configItem} style={{ flex: 1, justifyContent: 'flex-end' }}>
             <Space size="large">
               <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <SettingOutlined />
                 <span style={{ whiteSpace: 'nowrap' }}>Top K: {currentConfig.topK}</span>
                 <Slider 
                   min={1} max={10} 
                   value={currentConfig.topK}
                   onChange={(val) => setCurrentConfig({ topK: val })}
                   style={{ width: 100 }}
                 />
               </div>
               
               <Divider type="vertical" style={{ height: 24 }} />
               
               <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                 <span style={{ whiteSpace: 'nowrap' }}>阈值: {currentConfig.scoreThreshold}</span>
                 <Slider 
                   min={0} max={1} step={0.1}
                   value={currentConfig.scoreThreshold}
                   onChange={(val) => setCurrentConfig({ scoreThreshold: val })}
                   style={{ width: 100 }}
                 />
               </div>
             </Space>
          </div>
        </div>
      </Card>

      {/* 对话区 */}
      <Card className={styles.chatCard}>
        <div className={styles.messagesContainer}>
          {messages.length === 0 ? (
            <EmptyState
              title={chatMode === 'agent' ? 'Agent 智能问答' : '知识库对话'}
              description={chatMode === 'agent' 
                ? 'Agent 将自动分析您的意图，并调用合适的知识库进行回答' 
                : '选择知识库，直接进行检索问答'}
            />
          ) : (
            <>
              {messages.map(renderMessage)}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* 输入区 */}
        <div className={styles.inputArea}>
          <Input.TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={chatMode === 'agent' ? "输入问题，Agent 将为您思考..." : "输入问题..."}
            autoSize={{ minRows: 1, maxRows: 4 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isGenerating}
            className={styles.input}
          />
          <div className={styles.inputActions}>
            {chatMode === 'normal' && (
              <Button
                icon={<EditOutlined />}
                onClick={handleRewrite}
                loading={rewriting}
                disabled={!inputValue.trim() || isGenerating}
              >
                改写
              </Button>
            )}
            
            {isGenerating ? (
              <Button
                type="primary"
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!inputValue.trim()}
              >
                发送
              </Button>
            )}
          </div>
        </div>
      </Card>
      {/* 引用详情弹窗 */}
      <Modal
        title="参考来源详情"
        open={citationModalVisible}
        onCancel={() => setCitationModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setCitationModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={800}
      >
        {selectedCitation && (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            <div style={{ marginBottom: 16 }}>
               <Tag color="orange">{selectedCitation.kb_name || '未知知识库'}</Tag>
               <Tag color="blue">{selectedCitation.fileName || '未知文件'}</Tag>
               <Tag>{selectedCitation.location || '未知位置'}</Tag>
               <Tag color="green">相似度: {selectedCitation.score.toFixed(3)}</Tag>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '15px' }}>
                {selectedCitation.image_path ? (
                    <div style={{ textAlign: 'center' }}>
                        <img 
                            src={`http://localhost:8000/static/images/${selectedCitation.image_path}`} 
                            alt="引用图片详情" 
                            style={{ maxWidth: '100%', borderRadius: '8px' }}
                        />
                    </div>
                ) : (
                    selectedCitation.content
                )}
            </div>
            {/* 如果有图片，虽然 Citation 类型定义里暂时没有 image_path，但后端可能传过来。
                如果需要展示图片，可以在 Citation 类型中增加 image_path 字段。
                目前后端已经增加了 image_path，但前端 types/chat.ts 还没加。
                不过 JS 运行时是有的。我们先暂时忽略图片展示，或者加上。
             */}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Chat;
