/**
 * 召回测试模块
 */

import React, { useState } from 'react';
import { Card, Input, Slider, Button, Row, Col, Spin, Tag, Progress, Image } from 'antd';
import { SearchOutlined, FileTextOutlined } from '@ant-design/icons';
import { EmptyState, MarkdownRenderer } from '@/components/common';
import { executeRecallTest } from '@/services';
import { DEFAULT_RECALL_PARAMS } from '@/utils';
import type { RecallResult } from '@/types';
import styles from './RecallTest.module.css';

interface RecallTestProps {
  kbId: string;
}

const RecallTest: React.FC<RecallTestProps> = ({ kbId }) => {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState(DEFAULT_RECALL_PARAMS.topK);
  const [scoreThreshold, setScoreThreshold] = useState(DEFAULT_RECALL_PARAMS.scoreThreshold);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<RecallResult[]>([]);
  const [queryTime, setQueryTime] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 执行召回测试
  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setHasSearched(true);
    try {
      const response = await executeRecallTest(kbId, {
        query: query.trim(),
        topK,
        scoreThreshold,
      });
      setResults(response.data.results);
      setQueryTime(response.data.queryTime);
    } catch (error) {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // 渲染结果卡片
  const renderResultCard = (result: RecallResult, index: number) => {
    const scorePercent = Math.round(result.score * 100);
    const scoreColor =
      scorePercent >= 80 ? '#52c41a' : scorePercent >= 60 ? '#faad14' : '#ff4d4f';

    return (
      <Card key={result.chunkId} className={styles.resultCard}>
        <div className={styles.resultHeader}>
          <div className={styles.resultRank}>#{index + 1}</div>
          <div className={styles.scoreSection}>
            <span className={styles.scoreLabel}>相似度</span>
            <Progress
              percent={scorePercent}
              size="small"
              strokeColor={scoreColor}
              className={styles.scoreProgress}
            />
            <Tag color={scoreColor}>{result.score.toFixed(3)}</Tag>
          </div>
        </div>

        <div className={styles.resultMeta}>
          <Tag icon={<FileTextOutlined />}>{result.fileName}</Tag>
          <Tag>{result.location}</Tag>
        </div>

        <div className={styles.resultContent}>
          <MarkdownRenderer content={result.content} />
        </div>

        {result.imageUrl && (
          <div className={styles.resultImage}>
            <Image 
              src={result.imageUrl} 
              alt="相关图片" 
              height={200}
              style={{ objectFit: 'contain' }}
            />
          </div>
        )}
      </Card>
    );
  };

  return (
    <div className={styles.container}>
      <Row gutter={24}>
        {/* 左侧：参数配置 */}
        <Col span={8}>
          <Card title="参数配置" className={styles.configCard}>
            <div className={styles.formItem}>
              <label className={styles.label}>查询问题</label>
              <Input.TextArea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入要查询的问题..."
                rows={4}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
              />
            </div>

            <div className={styles.formItem}>
              <label className={styles.label}>Top K: {topK}</label>
              <Slider
                min={1}
                max={20}
                value={topK}
                onChange={setTopK}
                marks={{ 1: '1', 10: '10', 20: '20' }}
              />
            </div>

            <div className={styles.formItem}>
              <label className={styles.label}>
                相似度阈值: {scoreThreshold.toFixed(2)}
              </label>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={scoreThreshold}
                onChange={setScoreThreshold}
                marks={{ 0: '0', 0.5: '0.5', 1: '1' }}
              />
            </div>

            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={handleSearch}
              loading={loading}
              disabled={!query.trim()}
              block
            >
              执行召回
            </Button>
          </Card>
        </Col>

        {/* 右侧：结果展示 */}
        <Col span={16}>
          <Card
            title="召回结果"
            className={styles.resultContainer}
            extra={
              queryTime !== null && queryTime !== undefined && (
                <span className={styles.queryTime}>
                  查询耗时: {Number(queryTime).toFixed(2)}ms
                </span>
              )
            }
          >
            {loading ? (
              <div className={styles.loading}>
                <Spin size="large" />
              </div>
            ) : !hasSearched ? (
              <EmptyState
                title="输入问题开始测试"
                description="在左侧输入查询问题，点击执行召回查看结果"
              />
            ) : results.length === 0 ? (
              <EmptyState
                title="未找到相关结果"
                description="尝试降低相似度阈值或更换关键词"
              />
            ) : (
              <div className={styles.resultList}>
                {results.map((result, index) => renderResultCard(result, index))}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default RecallTest;
