export async function fetchHL7Tree(hl7: string) {
  const res = await fetch("/api/hl7/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: hl7 }),
  });

  return await res.json();
}
