import React, { useRef, useState } from "react";
import { UploadIcon } from "../../components/icons/Icon";
import { Button } from "../../components/ui/Button";

interface XmlUploadProps {
  onUpload: (file: File) => void;
}

const XmlUpload: React.FC<XmlUploadProps> = ({ onUpload }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      onUpload(file);
      event.target.value = "";
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div>
      <input ref={fileInputRef} type="file" accept=".xml,text/xml" className="hidden" onChange={handleFileChange} />

      <Button type="button" variant="secondary" onClick={handleButtonClick} aria-label="Import channel from XML" title="Import from XML" className="flex items-center gap-2">
        <UploadIcon className="w-4 h-4" />
        <span>Import from XML</span>
      </Button>
    </div>
  );
};

export default XmlUpload;
