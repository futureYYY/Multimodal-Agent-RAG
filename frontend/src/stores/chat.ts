/**
 * 对话状态管理
 */

import { create } from 'zustand';
import type { ChatMessage, ChatSession } from '@/types';

interface ChatState {
  // 当前会话
  currentSession: ChatSession | null;
  setCurrentSession: (session: ChatSession | null) => void;

  // 消息列表
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;

  // 选中的知识库 IDs
  selectedKbIds: string[];
  setSelectedKbIds: (ids: string[]) => void;

  // 选中的 LLM 模型
  selectedModel: string;
  setSelectedModel: (model: string) => void;

  // 是否正在生成
  isGenerating: boolean;
  setIsGenerating: (generating: boolean) => void;

  // 当前流式 controller
  abortController: (() => void) | null;
  setAbortController: (controller: (() => void) | null) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentSession: null,
  setCurrentSession: (session) => set({ currentSession: session }),

  messages: [],
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    })),
  clearMessages: () => set({ messages: [] }),

  selectedKbIds: [],
  setSelectedKbIds: (ids) => set({ selectedKbIds: ids }),

  selectedModel: '',
  setSelectedModel: (model) => set({ selectedModel: model }),

  isGenerating: false,
  setIsGenerating: (generating) => set({ isGenerating: generating }),

  abortController: null,
  setAbortController: (controller) => set({ abortController: controller }),
}));
