"""
对话服务 (Agent 实现)
"""

from typing import List, Dict, Any, AsyncGenerator, Tuple
from app.schemas import Message, RecallResult
from app.services.llm import LLMService
from app.services.embedding import EmbeddingService
from app.services.vector_store import VectorStoreService
from sqlmodel import Session, select
from app.core.database import engine
from app.models import KnowledgeBase, CustomModel


import os
import base64
from app.core.config import get_settings

settings = get_settings()

class ChatService:
# ... (rest of the class)
    """对话服务"""

    def __init__(self):
        self.llm_service = LLMService()
        self.embedding_service = EmbeddingService()
        self.vector_service = VectorStoreService()

    async def chat_stream(
        self,
        messages: List[Message],
        kb_ids: List[str],
        use_rewrite: bool = False,
        mode: str = "chat",
        top_k: int = 3,
        score_threshold: float = 0.3,
        model_id: str = None,
    ) -> AsyncGenerator[Tuple[str, Dict[str, Any]], None]:
        """
        流式对话
        """
        import sys
        print(f"DEBUG_CHAT: Start chat_stream. Messages count: {len(messages)}, KBs: {kb_ids}, Rewrite: {use_rewrite}", flush=True)
        sys.stdout.flush()
        
        # 获取用户最后一条消息
        user_message = None
        for msg in reversed(messages):
            if msg.role.value == "user":
                user_message = msg.content
                break
        
        print(f"DEBUG_CHAT: User message: {user_message}", flush=True)
        sys.stdout.flush()

        if not user_message:
            yield ("error", {"message": "没有找到用户消息"})
            return

        # Step 1: 意图识别
        yield ("agent_thought", {
            "step": "thinking",
            "content": "正在分析您的问题意图..."
        })

        # Agent 模式下强制开启改写，提升检索效果
        if mode == "agent":
            use_rewrite = True

        # 判断是否需要检索
        # 准备 LLM Service (处理自定义模型)
        current_llm_service = self.llm_service
        actual_model_id = model_id
        
        if model_id:
            with Session(engine) as session:
                custom_llm = session.get(CustomModel, model_id)
                if custom_llm:
                    current_llm_service = LLMService(
                        base_url=custom_llm.base_url,
                        api_key=custom_llm.api_key,
                        model=custom_llm.model_name
                    )
                    actual_model_id = custom_llm.model_name

        # 简单的意图判断 Prompt
        intent_prompt = f"""You are a helpful assistant. Determine if the user's query requires retrieving external knowledge (RAG) to answer.
If the query is a simple greeting, small talk, or general knowledge that doesn't need specific context, reply with "NO".
If the query is asking for specific information, facts, or requires searching a knowledge base, reply with "YES".

User Query: {user_message}

Reply only with YES or NO."""

        try:
            # 意图识别时不需要传入 model_id，因为这通常是一个简单的分类任务
            # 可以使用系统默认模型，或者使用轻量级模型
            # 但这里为了保险，还是使用用户选定的模型，但要确保参数传递正确
            # LLMService.generate 的签名已更新，支持 model_id
            
            # 注意：如果 intent_prompt 太长或者包含复杂指令，某些模型可能会报错
            # 对于 Qwen-VL 等多模态模型，纯文本 prompt 也是支持的
            intent_response = await current_llm_service.generate(
                messages=[{"role": "user", "content": intent_prompt}],
                model_id=actual_model_id
            )
            need_retrieval = "YES" in intent_response.upper()
            
            # 增加意图识别结果的思考展示
            yield ("agent_thought", {
                "step": "decision",
                "content": f"意图分析结果：{'需要检索外部知识' if need_retrieval else '无需检索，通用对话'}"
            })
            
            print(f"DEBUG_CHAT: Intent detection: {intent_response} -> Need Retrieval: {need_retrieval}")
        except Exception as e:
            print(f"DEBUG_CHAT: Intent detection failed: {e}, defaulting to Retrieval")
            need_retrieval = True

        query = user_message
        all_results = []
        
        if not need_retrieval:
            yield ("agent_thought", {
                "step": "decision",
                "content": "判定为通用对话，无需检索知识库。"
            })
            # 直接生成回答
            yield ("agent_thought", {
                "step": "response",
                "content": "正在直接生成回答..."
            })
            
            # 这种情况下没有 context，直接把原始对话发给 LLM
            chat_messages = [
                {"role": msg.role.value, "content": msg.content}
                for msg in messages
            ]
            
            try:
                async for chunk in current_llm_service.generate_stream(
                    messages=chat_messages,
                    model_id=actual_model_id,
                ):
                    yield ("answer_chunk", {"content": chunk})
            except Exception as e:
                yield ("error", {"message": f"生成回答失败: {str(e)}"})
            
            yield ("done", {"usage": {}})
            return

        # 如果需要检索
        # Step 2: 决策 - 是否需要改写
        if use_rewrite:
            yield ("agent_thought", {
                "step": "thinking", # 这里归类为 thinking 或者 decision 都可以
                "content": "正在思考是否需要优化查询语句..."
            })
            try:
                print("DEBUG_CHAT: Rewriting query...", flush=True)
                # 使用专门的 prompt 让 LLM 决定是否改写，或者直接强制改写
                # 这里为了简化，假设开启 use_rewrite 就总是尝试改写
                rewritten_query = await self.llm_service.rewrite_query(user_message)
                
                if rewritten_query and rewritten_query != user_message:
                    query = rewritten_query
                    yield ("agent_thought", {
                        "step": "decision",
                        "content": f"已将问题优化为：{query}"
                    })
                else:
                    yield ("agent_thought", {
                        "step": "decision",
                        "content": "无需修改问题。"
                    })
                    
                print(f"DEBUG_CHAT: Rewritten query: {query}", flush=True)
            except Exception as e:
                print(f"DEBUG_CHAT: Rewrite failed: {e}", flush=True)
                pass

        # Step 3: 行动 - 检索知识库
        # 获取知识库名称
        kb_names = []
        with Session(engine) as session:
            # 如果没有指定知识库（Agent 模式），则默认检索所有可用知识库
            if not kb_ids:
                print("DEBUG_CHAT: kb_ids is empty, fetching ALL active Knowledge Bases...")
                all_kbs = session.exec(select(KnowledgeBase).where(KnowledgeBase.is_deleted == False)).all()
                kb_ids = [kb.id for kb in all_kbs]
                kb_names = [kb.name for kb in all_kbs]
                print(f"DEBUG_CHAT: Auto-selected {len(kb_ids)} KBs: {kb_names}")
            else:
                # 使用 select 查询，更稳健
                for kb_id in kb_ids:
                    kb = session.get(KnowledgeBase, kb_id)
                    if kb:
                        kb_names.append(kb.name)
        
        kb_names_str = "、".join(kb_names) if kb_names else "全库检索"
        
        # 显式打印调试信息
        print(f"DEBUG_CHAT: [ACTION] Retrieving from Knowledge Bases: {kb_names_str} (IDs: {kb_ids})")
        
        yield ("agent_thought", {
            "step": "action",
            "content": f"正在检索知识库：{kb_names_str}"
        })

        # 获取查询向量
        try:
            print(f"DEBUG_CHAT: [ACTION] Embedding query: {query}")
            
            # 动态获取 Embedding Service 配置
            current_embedding_service = self.embedding_service
            
            if kb_ids:
                with Session(engine) as session:
                    # 使用第一个知识库的配置
                    first_kb = session.get(KnowledgeBase, kb_ids[0])
                    if first_kb:
                        emb_model_id = first_kb.embedding_model
                        custom_model = session.get(CustomModel, emb_model_id)
                        if custom_model:
                            print(f"DEBUG_CHAT: Using Custom Embedding Model: {custom_model.name}", flush=True)
                            current_embedding_service = EmbeddingService(
                                base_url=custom_model.base_url,
                                api_key=custom_model.api_key,
                                model=custom_model.model_name
                            )
            
            query_vector = await current_embedding_service.embed_query(query)
            print("DEBUG_CHAT: Embedding done.", flush=True)
        except Exception as e:
            print(f"DEBUG_CHAT: Embedding failed: {e}", flush=True)
            yield ("error", {"message": f"向量化失败: {str(e)}"})
            return

        # 在所有选中的知识库中检索
        kb_names_map = {}
        
        print(f"DEBUG_CHAT: [ACTION] Querying vector store for {len(kb_ids)} KBs...")
        with Session(engine) as session:
            for kb_id in kb_ids:
                kb = session.get(KnowledgeBase, kb_id)
                if kb:
                    kb_names_map[kb_id] = kb.name

                results = self.vector_service.query(
                    kb_id=kb_id,
                    query_vector=query_vector,
                    top_k=top_k,
                    score_threshold=score_threshold,
                )
                print(f"DEBUG_CHAT: KB {kb_id} ({kb_names_map.get(kb_id)}) results: {len(results)}", flush=True)

                for r in results:
                    r["kb_name"] = kb_names_map.get(kb_id, "未知")
                    r["kb_id"] = kb_id
                    all_results.append(r)

        # 按分数排序并去重
        all_results.sort(key=lambda x: x["score"], reverse=True)
        all_results = all_results[:5]  # 最多取 5 条
        print(f"DEBUG_CHAT: Total results after filter: {len(all_results)}", flush=True)

        # 发送 RAG 结果
        citations = [
            {
                "score": r["score"],
                "content": r["content"], # 不再截断，前端需要展示完整内容
                "fileName": r["metadata"].get("file_name", "未知"),
                "kb_name": r["kb_name"],
                "kb_id": r.get("kb_id"),
                "location": r["metadata"].get("location_info", ""),
                "fileId": r["metadata"].get("file_id"),
                "image_path": r["metadata"].get("image_path"), # 传递图片路径给前端
                "imageUrl": f"/static/images/{r['metadata'].get('image_path')}" if r["metadata"].get("image_path") else None
            }
            for r in all_results
        ]

        yield ("rag_result", {"citations": citations})

        # Step 4: 生成回答
        yield ("agent_thought", {
            "step": "response",
            "content": "正在基于检索结果生成回答..."
        })

        # 构建上下文
        context_parts = []
        for i, r in enumerate(all_results, 1):
            context_parts.append(f"[{i}] 来源: {r['metadata'].get('file_name', '未知')}\n{r['content']}")

        context = "\n\n".join(context_parts) if context_parts else "未找到相关信息"

        # 构建系统提示词
        system_prompt = f"""你是一个智能问答助手，请根据以下参考资料回答用户的问题。

参考资料：
{context}

要求：
1. 基于参考资料回答，如果资料中没有相关信息，请如实说明
2. 回答要准确、完整、有条理
3. 适当引用来源（如"根据文档..."）
4. 使用中文回答"""

        # 构建消息历史
        chat_messages = [
            {"role": msg.role.value, "content": msg.content}
            for msg in messages
        ]

        # 多模态增强：如果检索结果中包含图片，将其添加到最后一条用户消息中
        # 收集所有相关的图片
        retrieved_images = []
        for r in all_results:
            img_path = r["metadata"].get("image_path")
            if img_path:
                 # 构造完整路径
                 full_image_path = os.path.join(settings.IMAGE_DIR, img_path)
                 if os.path.exists(full_image_path):
                     try:
                         with open(full_image_path, "rb") as img_file:
                             encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                             # 获取扩展名
                             ext = os.path.splitext(img_path)[1].lower().replace('.', '')
                             if not ext: ext = 'jpeg'
                             if ext == 'jpg': ext = 'jpeg'
                             
                             retrieved_images.append(f"data:image/{ext};base64,{encoded_string}")
                     except Exception as e:
                         print(f"DEBUG_CHAT: Failed to read image {full_image_path}: {e}")

        # 如果有图片，修改最后一条用户消息
        if retrieved_images and chat_messages:
            last_msg = chat_messages[-1]
            if last_msg['role'] == 'user':
                original_text = last_msg['content']
                new_content = [{"type": "text", "text": original_text}]
                
                for img_data in retrieved_images:
                    new_content.append({
                        "type": "image_url",
                        "image_url": {"url": img_data}
                    })
                
                last_msg['content'] = new_content
                print(f"DEBUG_CHAT: Added {len(retrieved_images)} images to user message.")

        print("DEBUG_CHAT: calling llm_service.generate_stream...", flush=True)
        # 流式生成回答
        try:
            async for chunk in current_llm_service.generate_stream(
                messages=chat_messages,
                system_prompt=system_prompt,
                model_id=actual_model_id,
            ):
                print(f"DEBUG_CHAT: Received chunk: {chunk[:10]}...", flush=True)
                yield ("answer_chunk", {"content": chunk})

        except Exception as e:
            print(f"DEBUG_CHAT: Generate stream failed: {e}", flush=True)
            yield ("error", {"message": f"生成回答失败: {str(e)}"})
            return

        # 完成
        print("DEBUG_CHAT: Done.", flush=True)
        yield ("done", {"usage": {}})
