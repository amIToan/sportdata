type ResultBoard = {
  id: string;
  resultVersion: number;
  athlete1Id: string;
  athlete2Id: string;
  proposedWinnerId?: string | null;
  proposedWinMethod?: string | null;
  athlete1Score?: number;
  athlete2Score?: number;
};

export function isScoreboardTerminal(board: ResultBoard | undefined) {
  return board?.proposedWinMethod === 'SUBMISSION' || board?.proposedWinMethod === 'DISQUALIFICATION'
    || board?.proposedWinMethod === 'WALKOVVER'
    || (board?.athlete1Score ?? 0) >= 50 || (board?.athlete2Score ?? 0) >= 50;
}

export type ManualWinnerSelection = {
  boardId: string;
  resultVersion: number;
  athleteId: string;
};

export function getScoreboardResultSelection(board: ResultBoard | undefined, manualWinner: ManualWinnerSelection | null) {
  if (!board) return { winnerId: '', winMethod: 'DECISION', automatic: false };

  const participantIds = [board.athlete1Id, board.athlete2Id];
  if (board.proposedWinnerId) {
    return {
      winnerId: participantIds.includes(board.proposedWinnerId) ? board.proposedWinnerId : '',
      winMethod: board.proposedWinMethod || 'DECISION',
      automatic: true,
    };
  }

  const currentManualWinner = manualWinner?.boardId === board.id
    && manualWinner.resultVersion === board.resultVersion
    && participantIds.includes(manualWinner.athleteId);
  return {
    winnerId: currentManualWinner ? manualWinner.athleteId : '',
    winMethod: 'DECISION',
    automatic: false,
  };
}
