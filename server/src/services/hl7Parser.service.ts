// server/src/services/hl7Parser.ts

export interface HL7Node {
  id: string;
  name: string;
  value?: string;
  path: string;
  children?: HL7Node[];
}

export function parseHL7ToTree(message: string): HL7Node[] {
  if (!message) return [];

  const segments = message.split(/\r?\n/).filter((line) => line.trim() !== "");

  const tree: HL7Node[] = [];

  for (const seg of segments) {
    const fields = seg.split("|");
    const segName = fields[0];

    const segmentNode: HL7Node = {
      id: segName,
      name: segName,
      path: `msg['${segName}']`,
      children: [],
    };

    for (let i = 1; i < fields.length; i++) {
      const fieldValue = fields[i];

      const fieldNode: HL7Node = {
        id: `${segName}.${i}`,
        name: `${segName}.${i}`,
        value: fieldValue.includes("^") ? undefined : fieldValue,
        path: `msg['${segName}']['${segName}.${i}']`,
        children: [],
      };

      if (fieldValue.includes("^")) {
        const components = fieldValue.split("^");

        components.forEach((comp, cIndex) => {
          const compNode: HL7Node = {
            id: `${segName}.${i}.${cIndex + 1}`,
            name: `${segName}.${i}.${cIndex + 1}`,
            value: comp,
            path: `msg['${segName}']['${segName}.${i}']['${segName}.${i}.${cIndex + 1}']`,
          };

          fieldNode.children!.push(compNode);
        });
      }

      segmentNode.children!.push(fieldNode);
    }

    tree.push(segmentNode);
  }

  return tree;
}
