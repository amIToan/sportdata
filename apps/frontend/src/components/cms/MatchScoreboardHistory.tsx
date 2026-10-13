'use client';

import { Card, Empty, Table, Tag } from 'antd';
import { formatDate } from '@/lib/utils';
import { formatScoreboardTime, SCOREBOARD_AWARD_LABELS, type ScoreboardAward } from '@/lib/scoreboard-history';

export type ScoreboardHistoryMatch = {
  athlete1?: { fullName: string } | null;
  athlete2?: { fullName: string } | null;
  resultData?: { scoreboard?: { actions?: ScoreboardAward[] } } | null;
};

export function MatchScoreboardHistory({ match }: { match: ScoreboardHistoryMatch }) {
  const actions = match.resultData?.scoreboard?.actions || [];
  const athleteName = (side: number) => (side === 1 ? match.athlete1 : match.athlete2)?.fullName || `VĐV ${side}`;
  return (
    <Card id="scoreboard-history" className="cms-surface scroll-mt-6" style={{ marginBlock: 24 }} title="Lịch sử thao tác trọng tài" extra={<Tag>{actions.length} thao tác</Tag>}>
      {actions.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có thao tác chấm điểm." /> : (
        <Table<ScoreboardAward>
          rowKey="id"
          size="small"
          dataSource={[...actions].reverse()}
          scroll={{ x: 750 }}
          pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
          columns={[
            { title: 'Thời điểm', key: 'at', width: 155, render: (_, action) => <><div>{formatDate(action.at, 'HH:mm:ss dd/MM/yyyy')}</div><div className="text-xs text-slate-500">Còn {formatScoreboardTime(action.remainingMs)}</div></> },
            { title: 'Vận động viên', key: 'athlete', width: 200, render: (_, action) => <><Tag color={action.side === 1 ? 'red' : 'cyan'}>{action.side === 1 ? 'Đỏ' : 'Xanh'}</Tag><span>{athleteName(action.side)}</span></> },
            { title: 'Thao tác', key: 'award', render: (_, action) => <div className={action.undone ? 'text-slate-500 line-through' : ''}>
              {SCOREBOARD_AWARD_LABELS[action.award] || action.award}{action.award === 'POINTS' ? ` +${action.points}` : action.penaltyLevel ? ` ${action.penaltyLevel}P` : ''}
              {action.source === 'STALLING_TIMER' && <span> · Hết 10 giây thụ động</span>}
              {action.opponentAward && <div className="mt-1 text-xs">{athleteName(action.opponentAward.side)}: +{action.opponentAward.points} {SCOREBOARD_AWARD_LABELS[action.opponentAward.award]}</div>}
              {action.scoreChanges?.map((change) => <div key={change.side} className="mt-1 text-xs">{athleteName(change.side)}: {change.before} → {change.after} điểm</div>)}
            </div> },
            { title: 'Trạng thái', key: 'state', width: 120, render: (_, action) => <Tag color={action.undone ? 'default' : 'green'}>{action.undone ? 'Đã hoàn tác' : 'Có hiệu lực'}</Tag> },
          ]}
        />
      )}
    </Card>
  );
}
