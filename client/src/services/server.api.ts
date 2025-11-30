export const checkServerStatus = async (): Promise<boolean> => {
  try {
    const res = await fetch("/api/status");
    return res.ok;
  } catch {
    return false;
  }
};
