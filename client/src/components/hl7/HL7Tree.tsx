import React, { useState, useEffect } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from '../icons/Icon';
import { fetchHL7Tree } from '../../services/hl7.api';

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

const TreeNode: React.FC<{ node: HL7Node; onNodeClick?: (path: string, val?: string) => void }> = ({
  node,
  onNodeClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = () => {
    if (onNodeClick) onNodeClick(node.path, node.value);
    if (hasChildren) setIsExpanded((x) => !x);
  };

  return (
    <div style={{ marginLeft: 16 }}>
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          gap: 6,
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
      >
        {hasChildren ? (
          isExpanded ? (
            <ChevronDownIcon className="w-3 h-3" />
          ) : (
            <ChevronRightIcon className="w-3 h-3" />
          )
        ) : (
          <span className="w-3 h-3 inline-block" />
        )}

        <span style={{ fontWeight: 600 }}>{node.name}</span>
        {node.value && <span style={{ color: 'var(--text-soft)' }}>: {node.value}</span>}
      </div>

      {hasChildren && isExpanded && (
        <div style={{ borderLeft: '1px solid var(--border-main)', marginLeft: 6, paddingLeft: 6 }}>
          {node.children!.map((child) => (
            <TreeNode key={child.id} node={child} onNodeClick={onNodeClick} />
          ))}
        </div>
      )}
    </div>
  );
};

export const HL7Tree: React.FC<HL7TreeProps> = ({ hl7, onNodeClick }) => {
  const [treeData, setTreeData] = useState<HL7Node[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!hl7) {
      setTreeData([]);
      setLoading(false);
      return;
    }
    setTreeData([]);
    setLoading(true);

    fetchHL7Tree(hl7)
      .then((tree) => {
        if (!active) return;
        setTreeData(tree || []);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setTreeData([]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hl7]);

  if (!hl7) return <div className="code-box">No HL7 data provided.</div>;
  if (loading) return <div className="code-box">Parsing HL7...</div>;
  if (!treeData.length) return <div className="code-box">Failed to parse HL7 message.</div>;

  return (
    <div className="code-box">
      {treeData.map((node) => (
        <TreeNode key={node.id} node={node} onNodeClick={onNodeClick} />
      ))}
    </div>
  );
};
