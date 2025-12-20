"""
召回测试 API 路由
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session
from typing import List

from app.core.database import get_session
from app.models import KnowledgeBase
from app.schemas import RecallRequest, RecallResult, ApiResponse, RecallTestResponse
from app.services.vector_store import VectorStoreService
from app.services.embedding import EmbeddingService
import time
import re

router = APIRouter(tags=["Recall"])


@router.post(
    "/knowledge-bases/{kb_id}/recall",
    response_model=ApiResponse[RecallTestResponse],
)
async def recall_test(
    kb_id: str,
    data: RecallRequest,
    session: Session = Depends(get_session),
):
    """执行召回测试"""
    start_time = time.time()
    
    # 检查知识库是否存在
    kb = session.get(KnowledgeBase, kb_id)
    if not kb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": 40401, "message": "知识库不存在"},
        )

    try:
        # 获取查询向量
        embedding_service = EmbeddingService()
        query_vector = await embedding_service.embed_query(data.query)

        # 执行向量检索
        vector_service = VectorStoreService()
        results = vector_service.query(
            kb_id=kb_id,
            query_vector=query_vector,
            top_k=data.top_k,
            score_threshold=data.score_threshold,
        )

        # 格式化返回结果
        result_list = []
        for r in results:
            # 处理图片 URL
            image_path = r["metadata"].get("image_path")
            image_url = None
            
            if image_path:
                image_url = f"/static/images/{image_path}"
            else:
                # 尝试从 content 中解析 [图片: path]
                match = re.search(r"\[图片:\s*(.+?)\]", r["content"])
                if match:
                    path_in_content = match.group(1).strip()
                    if not path_in_content.startswith("/static/images/"):
                            image_url = f"/static/images/{path_in_content}"
                    else:
                            image_url = path_in_content

            result_list.append(RecallResult(
                chunkId=r.get("id"),
                score=r["score"],
                content=r["content"],
                fileName=r["metadata"].get("file_name", "未知"),
                kbName=kb.name,
                location=r["metadata"].get("location_info", ""),
                imageUrl=image_url
            ))
        
        end_time = time.time()
        query_time = (end_time - start_time) * 1000 # 毫秒

        return ApiResponse(data=RecallTestResponse(
            results=result_list,
            query_time=query_time
        ))

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": 50001, "message": f"召回测试失败: {str(e)}"},
        )
