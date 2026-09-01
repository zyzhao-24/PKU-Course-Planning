const parseSemester = (semester) => {
  const match = String(semester || '').match(/^(\d{2})-(\d{2})-([123])$/);
  if (!match) return null;
  return {
    startYear: Number(match[1]),
    endYear: Number(match[2]),
    term: Number(match[3]),
  };
};

export const sortSemestersDescending = (semesters) => [...(semesters || [])].sort((left, right) => {
  const parsedLeft = parseSemester(left);
  const parsedRight = parseSemester(right);
  if (!parsedLeft && !parsedRight) return String(right).localeCompare(String(left), 'zh-CN', { numeric: true });
  if (!parsedLeft) return 1;
  if (!parsedRight) return -1;
  return (
    parsedRight.startYear - parsedLeft.startYear ||
    parsedRight.endYear - parsedLeft.endYear ||
    parsedRight.term - parsedLeft.term
  );
});
