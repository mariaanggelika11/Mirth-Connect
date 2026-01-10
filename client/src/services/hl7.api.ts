export async function fetchHL7Tree(hl7: string) {
  const token = localStorage.getItem("authToken");

  const res = await fetch("http://localhost:9000/api/hl7/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: hl7 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || "Failed to parse HL7");
  }

  return await res.json();
}
