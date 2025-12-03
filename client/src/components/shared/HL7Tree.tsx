import React, { useState, useEffect } from "react";
import { ChevronRightIcon, ChevronDownIcon } from "../icons/Icon";
import { fetchHL7Tree } from "../../services/hl7.api";

export interface HL7Node {
  id: string;
  name: string;
  value?: string;
  path: string;
  children?: HL7Node[];
}

interface HL7TreeProps {
  hl7: string;
  onNodeClick?: (path: string, value?: string) => void;
}

/* ================================
   TREE NODE COMPONENT
================================ */
const TreeNode: React.FC<{ node: HL7Node; onNodeClick?: (path: string, val?: string) => void }> = ({ node, onNodeClick }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const isSegment = !node.id.includes(".");
  const isField = node.id.split(".").length === 2;

  const labelColor = isSegment ? "text-yellow-400 font-bold" : isField ? "text-cyan-300" : "text-emerald-300";

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (onNodeClick) {
      onNodeClick(node.path, node.value);
    }

    if (hasChildren) {
      setIsExpanded((x) => !x);
    }
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((x) => !x);
  };

  return (
    <div className="ml-4 select-none">
      <div className="flex items-start gap-1 py-0.5 hover:bg-slate-700/50 rounded cursor-pointer group" onClick={handleClick}>
        <span onClick={handleToggle} className="pt-1 text-slate-500 hover:text-white">
          {hasChildren ? isExpanded ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" /> : <div className="w-3 h-3" />}
        </span>

        <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
          <span className={`text-xs ${labelColor} font-mono whitespace-nowrap`}>{node.name}</span>
          {node.value && <span className="text-xs text-slate-400 font-mono break-all group-hover:text-white">: {node.value}</span>}
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="border-l border-slate-700 ml-1.5 pl-1">
          {node.children!.map((child) => (
            <TreeNode key={child.id} node={child} onNodeClick={onNodeClick} />
          ))}
        </div>
      )}
    </div>
  );
};

/* ================================
   MAIN HL7 TREE COMPONENT
================================ */
export const HL7Tree: React.FC<HL7TreeProps> = ({ hl7, onNodeClick }) => {
  const [treeData, setTreeData] = useState<HL7Node[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hl7) return;

    setLoading(true);

    fetchHL7Tree(hl7)
      .then((tree) => {
        setTreeData(tree || []);
        setLoading(false);
      })
      .catch(() => {
        setTreeData([]);
        setLoading(false);
      });
  }, [hl7]);

  if (!hl7) {
    return <div className="p-4 text-slate-500 italic text-sm">No HL7 data provided.</div>;
  }

  if (loading) {
    return <div className="p-4 text-slate-500 italic text-sm">Parsing HL7...</div>;
  }

  if (!treeData.length) {
    return <div className="p-4 text-slate-500 italic text-sm">Failed to parse HL7 message.</div>;
  }

  return (
    <div className="p-2 overflow-x-auto">
      {treeData.map((node) => (
        <TreeNode key={node.id} node={node} onNodeClick={onNodeClick} />
      ))}
    </div>
  );
};
