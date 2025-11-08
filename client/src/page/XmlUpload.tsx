import React, { useRef, useState } from "react";
import { UploadIcon } from "../components/icons/Icon";
import { Button } from "../components/shared/Button";

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
      // Reset file input to allow uploading the same file again
      event.target.value = "";
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div>
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xml,text/xml" />
      <Button onClick={handleButtonClick} variant="secondary">
        <UploadIcon />
        Import from XML
      </Button>
    </div>
  );
};

export default XmlUpload;
