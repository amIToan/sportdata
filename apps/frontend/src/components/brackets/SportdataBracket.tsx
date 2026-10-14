'use client';

import { imageUrl } from '@/lib/image-url';

import { useRef, useState } from 'react';
import { useBracketViewport } from './useBracketViewport';
import Link from 'next/link';
import { Avatar, Button, Card, Tag, Tooltip } from 'antd';
import { ChevronDown, ChevronUp, Download, Maximize2, Minus, Plus, RotateCcw, UserRound } from 'lucide-react';
import { cn, formatDate, formatTime } from '@/lib/utils';

export interface BracketCountry {
  code?: string;
  name?: string;
  flagUrl?: string | null;
}

export interface BracketAthlete {
  isTeam?: boolean;
  id: string;
  fullName: string;
  photoUrl?: string | null;
  country?: BracketCountry | null;
  federation?: { id?: string; name?: string } | null;
}

export interface BracketMatch {
  id: string;
  matchNumber?: number | null;
  fop?: string | null;
  matchDate: string;
  startTime?: string | null;
  team1?: { id: string; name: string; country?: BracketCountry | null; members?: { athlete: { fullName: string } }[] } | null;
  team2?: BracketMatch['team1'];
  winnerTeamId?: string | null;
  athlete1?: BracketAthlete | null;
  athlete2?: BracketAthlete | null;
  athlete1Score: number;
  athlete2Score: number;
  winnerId?: string | null;
  status: string;
  round?: number | null;
  bracketPosition?: number | null;
  winnerToMatchId?: string | null;
  winnerToSide?: 'ATHLETE1' | 'ATHLETE2' | null;
  loserToMatchId?: string | null;
  loserToSide?: 'ATHLETE1' | 'ATHLETE2' | null;
  notes?: string | null;
}

export interface BracketDraw {
  id: string;
  name: string;
  type: 'ROUND_ROBIN_POOL' | 'MAIN_TREE' | 'POOL_WINNER_TREE' | 'REPECHAGE' | 'REPECHAGE_ROUND_OF_16' | 'DOUBLE_ELIMINATION';
  bracketSize?: number | null;
  sortOrder: number;
  matches: BracketMatch[];
}

type SportdataBracketProps = {
  draw: BracketDraw;
  sourceMatches?: BracketMatch[];
  readOnly?: boolean;
  matchHref?: (match: BracketMatch, athlete?: BracketAthlete | null) => string | undefined;
  onExportPdf?: (board: HTMLElement, heading: HTMLElement) => Promise<void>;
};

const BRACKET_NODE_WIDTH = 390;
const BRACKET_NODE_HEIGHT = 80;
const BRACKET_SLOT_PITCH = 116;
const BRACKET_COLUMN_STEP = 470;
const BRACKET_HEADER_HEIGHT = 64;

export function SportdataBracket({ draw, sourceMatches = draw.matches, readOnly = false, matchHref, onExportPdf }: SportdataBracketProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const matches = draw.matches.map((match) => ({ ...match,
    athlete1: match.athlete1 || (match.team1 ? { id: match.team1.id, isTeam: true, fullName: match.team1.members?.map((member) => member.athlete.fullName).join(' / ') || match.team1.name, country: match.team1.country } : null),
    athlete2: match.athlete2 || (match.team2 ? { id: match.team2.id, isTeam: true, fullName: match.team2.members?.map((member) => member.athlete.fullName).join(' / ') || match.team2.name, country: match.team2.country } : null),
    winnerId: match.winnerId || match.winnerTeamId,
  })).sort((left, right) => {
    if ((left.round || 0) !== (right.round || 0)) return (left.round || 0) - (right.round || 0);
    return (left.bracketPosition || 0) - (right.bracketPosition || 0);
  });
  const roundNumbers = Array.from(new Set(matches.map((match) => match.round || 1))).sort((a, b) => a - b);
  const roundOrdinal = new Map(roundNumbers.map((round, index) => [round, index + 1]));
  const firstRound = matches.filter((match) => (match.round || 1) === roundNumbers[0]);
  const isRoundRobin = draw.type === 'ROUND_ROBIN_POOL';
  const bracketSize = Math.max(draw.bracketSize || 0, firstRound.length * 2, 2,
    isRoundRobin ? Math.max(0, ...matches.map((match) => ((match.bracketPosition || 0) + 1) * 2)) : 0);
  const boardHeight = BRACKET_HEADER_HEIGHT + (bracketSize - 1) * BRACKET_SLOT_PITCH + BRACKET_NODE_HEIGHT + 30;
  const boardWidth = Math.max(0, roundNumbers.length - (isRoundRobin ? 1 : 0)) * BRACKET_COLUMN_STEP + BRACKET_NODE_WIDTH + 40;
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const finalMatch = matches.find((match) => (match.round || 1) === roundNumbers.at(-1));

  const { viewportRef, scale, autoFit, minScale, maxScale, changeScale, enableAutoFit, resetScale } = useBracketViewport(boardWidth, boardHeight, collapsed);
  const terminalMatches = matches.filter((match) => (match.round || 1) === roundNumbers.at(-1));
  const isRepechage = draw.type === 'REPECHAGE' || draw.type === 'REPECHAGE_ROUND_OF_16';
  const feederLabels = new Map<string, string>();
  sourceMatches.forEach((source) => {
    const label = source.matchNumber ? `trận #${source.matchNumber}` : `vòng ${source.round || 1}, trận ${(source.bracketPosition || 0) + 1}`;
    if (source.winnerToMatchId && source.winnerToSide) feederLabels.set(`${source.winnerToMatchId}-${source.winnerToSide}`, `Thắng ${label}`);
    if (source.loserToMatchId && source.loserToSide) feederLabels.set(`${source.loserToMatchId}-${source.loserToSide}`, `Thua ${label}`);
  });

  const nodeTop = (ordinal: number, slotIndex: number) => {
    const roundNumber = roundNumbers[ordinal - 1];
    const matchCount = matches.filter((match) => (match.round || 1) === roundNumber).length;
    const factor = isRoundRobin ? 1 : bracketSize / Math.max(matchCount * 2, 1);
    return BRACKET_HEADER_HEIGHT + (slotIndex * factor + (factor - 1) / 2) * BRACKET_SLOT_PITCH;
  };

  const connectors = matches.map((match) => {
    const ordinal = roundOrdinal.get(match.round || 1) || 1;
    const position = match.bracketPosition || 0;
    const firstY = nodeTop(ordinal, position * 2) + BRACKET_NODE_HEIGHT / 2;
    const secondY = nodeTop(ordinal, position * 2 + 1) + BRACKET_NODE_HEIGHT / 2;
    const sourceX = (ordinal - 1) * BRACKET_COLUMN_STEP + BRACKET_NODE_WIDTH;
    const elbowX = sourceX + (BRACKET_COLUMN_STEP - BRACKET_NODE_WIDTH) / 2;
    let targetX = ordinal * BRACKET_COLUMN_STEP;
    let targetY = (firstY + secondY) / 2;

    if (match.winnerToMatchId) {
      const target = matchById.get(match.winnerToMatchId);
      if (target) {
        const targetOrdinal = roundOrdinal.get(target.round || 1) || ordinal + 1;
        const targetPosition = target.bracketPosition || 0;
        const targetSideIndex = match.winnerToSide === 'ATHLETE2' ? 1 : 0;
        targetX = (targetOrdinal - 1) * BRACKET_COLUMN_STEP;
        targetY = nodeTop(targetOrdinal, targetPosition * 2 + targetSideIndex) + BRACKET_NODE_HEIGHT / 2;
      } else if (ordinal !== roundNumbers.length) {
        return null;
      }
    } else if (ordinal !== roundNumbers.length) {
      return null;
    }

    return (
      <g key={`connector-${match.id}`}>
        <path d={`M ${sourceX} ${firstY} H ${elbowX}`} />
        <path d={`M ${sourceX} ${secondY} H ${elbowX}`} />
        <path d={`M ${elbowX} ${firstY} V ${secondY}`} />
        <path d={`M ${elbowX} ${(firstY + secondY) / 2} H ${targetX} V ${targetY}`} />
      </g>
    );
  });

  return (
    <Card className="category-bracket-card sportdata-draw" styles={{ body: { padding: 0 } }}>
      <div className="sportdata-draw-title">
        <div className="sportdata-draw-heading" ref={headingRef}>
          <span>{draw.name}</span>
          <Tag bordered={false}>{drawTypeLabel(draw.type)}</Tag>
        </div>
        <div className="sportdata-draw-controls" role="toolbar" aria-label={`Điều khiển ${draw.name}`}>
          <Tooltip title="Thu nhỏ cây">
            <Button
              aria-label="Thu nhỏ cây"
              className="sportdata-draw-control"
              disabled={collapsed || scale <= minScale}
              icon={<Minus className="h-4 w-4" />}
              onClick={() => changeScale(-0.1)}
              size="small"
              type="text"
            />
          </Tooltip>
          <span className="sportdata-zoom-value" aria-live="polite">{Math.round(scale * 100)}%</span>
          <Tooltip title="Phóng to cây">
            <Button
              aria-label="Phóng to cây"
              className="sportdata-draw-control"
              disabled={collapsed || scale >= maxScale}
              icon={<Plus className="h-4 w-4" />}
              onClick={() => changeScale(0.1)}
              size="small"
              type="text"
            />
          </Tooltip>
          <Button
            aria-label="Tự động thu cây vừa khung"
            className={cn('sportdata-draw-control', autoFit && 'is-active')}
            disabled={collapsed}
            icon={<Maximize2 className="h-4 w-4" />}
            onClick={enableAutoFit}
            size="small"
            type="text"
          >
            Vừa khung
          </Button>
          <Tooltip title="Đặt lại tỷ lệ 100%">
            <Button
              aria-label="Đặt lại tỷ lệ 100%"
              className="sportdata-draw-control"
              disabled={collapsed}
              icon={<RotateCcw className="h-4 w-4" />}
              onClick={resetScale}
              size="small"
              type="text"
            />
          </Tooltip>
          {onExportPdf && <Button
            aria-label={`Xuất PDF ${draw.name}`}
            className="sportdata-draw-control"
            icon={<Download className="h-4 w-4" />}
            loading={exporting}
            disabled={collapsed}
            onClick={async () => {
              if (exporting || !boardRef.current || !headingRef.current) return;
              setExporting(true);
              try { await onExportPdf(boardRef.current, headingRef.current); } finally { setExporting(false); }
            }}
            size="small"
            type="text"
          >Xuất PDF</Button>}
          <Button
            aria-label={collapsed ? 'Mở cây thi đấu' : 'Thu gọn cây thi đấu'}
            aria-expanded={!collapsed}
            className="sportdata-draw-control sportdata-collapse-control"
            icon={collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            onClick={() => setCollapsed((current) => !current)}
            size="small"
            type="text"
          >
            {collapsed ? 'Mở cây' : 'Thu gọn'}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <>
          <p className="sportdata-bracket-hint">Chụm/tách hai ngón để zoom · Vuốt hai ngón để di chuyển trong khung</p>
          <div className="sportdata-bracket-scroll" ref={viewportRef} role="region" aria-label={`Cây thi đấu ${draw.name}`} tabIndex={0}>
            <div className="sportdata-bracket-stage" style={{ width: boardWidth * scale, height: boardHeight * scale }}>
              <div
                className="sportdata-bracket-board"
                ref={boardRef}
                style={{ width: boardWidth, height: boardHeight, transform: `scale(${scale})` }}
              >
                {roundNumbers.map((round, index) => (
                  <div
                    className="sportdata-round-title"
                    key={round}
                    style={{ left: index * BRACKET_COLUMN_STEP, width: BRACKET_NODE_WIDTH }}
                  >
                    {isRoundRobin ? `${draw.name} · Lượt ${index + 1}` : isRepechage ? (round === roundNumbers.at(-1) ? 'Tranh HCĐ A / B' : `Đấu vớt · Vòng ${index + 1}`) : draw.type === 'DOUBLE_ELIMINATION' ? (round === roundNumbers.at(-1) ? 'Chung kết tổng' : `Nhánh thua · Vòng ${index + 1}`) : `${draw.name} - Vòng ${index + 1}`}
                  </div>
                ))}
                {!isRoundRobin && <div
                  className="sportdata-round-title is-champion"
                  style={{ left: roundNumbers.length * BRACKET_COLUMN_STEP, width: BRACKET_NODE_WIDTH }}
                >
                  {isRepechage ? 'Đồng hạng 3 · HCĐ' : finalMatch?.winnerToMatchId ? 'Thắng nhánh · Đi tiếp' : 'Vô địch'}
                </div>}
                <svg
                  aria-hidden="true"
                  className="sportdata-bracket-lines"
                  width={boardWidth}
                  height={boardHeight}
                  viewBox={`0 0 ${boardWidth} ${boardHeight}`}
                >
                  {!isRoundRobin && connectors}
                </svg>
                {matches.flatMap((match) => {
                  const ordinal = roundOrdinal.get(match.round || 1) || 1;
                  const position = match.bracketPosition || 0;
                  const left = (ordinal - 1) * BRACKET_COLUMN_STEP;
                  return [
                    <BracketParticipantNode
                      key={`${match.id}-athlete1`}
                      match={match}
                      athlete={match.athlete1}
                      placeholder={feederLabels.get(`${match.id}-ATHLETE1`)}
                      score={match.athlete1Score}
                      side="red"
                      winner={match.winnerId === match.athlete1?.id}
                      left={left}
                      top={nodeTop(ordinal, position * 2)}
                      matchHref={matchHref}
                      readOnly={readOnly}
                    />,
                    <BracketParticipantNode
                      key={`${match.id}-athlete2`}
                      match={match}
                      athlete={match.athlete2}
                      placeholder={feederLabels.get(`${match.id}-ATHLETE2`)}
                      score={match.athlete2Score}
                      side="blue"
                      winner={match.winnerId === match.athlete2?.id}
                      left={left}
                      top={nodeTop(ordinal, position * 2 + 1)}
                      matchHref={matchHref}
                      readOnly={readOnly}
                    />,
                  ];
                })}
                {!isRoundRobin && terminalMatches.map((match, index) => {
                  const winner = match.status === 'FINISHED' && match.winnerId
                    ? [match.athlete1, match.athlete2].find((athlete) => athlete?.id === match.winnerId)
                    : null;
                  const position = match.bracketPosition || 0;
                  const ordinal = roundOrdinal.get(match.round || 1) || 1;
                  return (
                    <BracketParticipantNode
                      key={`terminal-${match.id}`}
                      match={match}
                      athlete={winner}
                      placeholder={isRepechage ? `HCĐ ${index === 0 ? 'A' : 'B'} — CHỜ KẾT QUẢ` : 'CHỜ KẾT QUẢ'}
                      side="champion"
                      winner={Boolean(winner)}
                      left={roundNumbers.length * BRACKET_COLUMN_STEP}
                      top={(nodeTop(ordinal, position * 2) + nodeTop(ordinal, position * 2 + 1)) / 2}
                      matchHref={matchHref}
                      readOnly={readOnly}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function BracketParticipantNode({
  match,
  athlete,
  score,
  placeholder,
  side,
  winner,
  left,
  top,
  matchHref,
  readOnly,
}: {
  match: BracketMatch;
  athlete?: BracketAthlete | null;
  score?: number;
  placeholder?: string;
  side: 'red' | 'blue' | 'champion';
  winner: boolean;
  left: number;
  top: number;
  matchHref?: SportdataBracketProps['matchHref'];
  readOnly: boolean;
}) {
  const content = (
    <>
      <Avatar
        shape="square"
        size={58}
        src={imageUrl(athlete && !athlete.isTeam ? athlete.photoUrl || `/api/participant-auth/avatar/${athlete.id}` : undefined, 'avatar')}
        icon={<UserRound className="h-6 w-6" />}
        alt={athlete?.fullName || 'Vận động viên'}
        className="sportdata-node-avatar"
      />
      <div className="sportdata-node-country">
        <CountryFlag country={athlete?.country} />
        <span>{athlete?.country?.code || '—'}</span>
      </div>
      {side !== 'champion' && (
        <span className={cn('sportdata-node-score', readOnly && 'is-readonly')}>
          {athlete && ['FINISHED', 'RUNNING'].includes(match.status) ? score ?? 0 : '—'}
        </span>
      )}
      <strong>{athlete?.fullName || placeholder || 'CHỜ XÁC ĐỊNH'}</strong>
      <small>{athlete?.federation?.name || athlete?.country?.name || '—'}</small>
      {side !== 'champion' && (
        <span className="sportdata-node-match">
          {match.matchNumber ? `#${match.matchNumber}` : ''}
          {[
            match.startTime
              ? `${formatDate(match.startTime, 'dd/MM')} ${formatTime(match.startTime)}`
              : formatDate(match.matchDate, 'dd/MM'),
            match.fop,
          ].filter(Boolean).join(' · ')}
        </span>
      )}
    </>
  );
  const className = cn(
    'sportdata-bracket-node',
    `is-${side}`,
    winner && 'is-winner',
    !athlete && 'is-empty',
    readOnly && 'is-readonly',
  );
  const style = { left, top, width: BRACKET_NODE_WIDTH, height: BRACKET_NODE_HEIGHT };
  const href = readOnly ? undefined : matchHref
    ? matchHref(match, athlete)
    : athlete
      ? athlete.isTeam ? undefined : `/athletes/${athlete.id}`
      : undefined;

  return href ? (
    <Link href={href} className={className} style={style} title={match.notes || undefined}>{content}</Link>
  ) : (
    <div className={className} style={style} title={match.notes || undefined}>{content}</div>
  );
}

function drawTypeLabel(type: BracketDraw['type']) {
  return ({
    ROUND_ROBIN_POOL: 'Vòng tròn',
    MAIN_TREE: 'Main tree',
    POOL_WINNER_TREE: 'Poolwinner tree',
    REPECHAGE: 'Repechage',
    REPECHAGE_ROUND_OF_16: 'Repechage 1/8',
    DOUBLE_ELIMINATION: 'Loại kép',
  } as const)[type];
}

function CountryFlag({ country }: { country?: BracketCountry | null }) {
  if (country?.flagUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={country.flagUrl} alt={country.code || ''} className="bracket-country-flag" />
    );
  }

  return <span className="bracket-country-fallback">{country?.code?.slice(0, 2) || '—'}</span>;
}
