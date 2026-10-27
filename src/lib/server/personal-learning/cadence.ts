const studyTargets = [1, 7, 30];

export function canContinue(completedSessions: number, targetSessions: number) {
  return studyTargets.includes(targetSessions) && completedSessions >= 0 && completedSessions < targetSessions;
}

export function isReviewBoundary(targetSessions: number, sessionIndex: number) {
  if (targetSessions === 30) return [7, 14, 21, 28, 30].includes(sessionIndex);
  return (targetSessions === 1 || targetSessions === 7) && sessionIndex === targetSessions;
}

export function isValidExtension(currentTarget: number, newTarget: number) {
  return (currentTarget === 1 && (newTarget === 7 || newTarget === 30)) ||
    (currentTarget === 7 && newTarget === 30);
}
