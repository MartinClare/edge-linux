import React, { useState, useRef } from 'react';

interface ImageUploadProps {
  onImageSelect: (file: File) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageSelect,
  onAnalyze,
  isAnalyzing,
}) => {
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    onImageSelect(file);
  };

  return (
    <div className="image-upload">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      
      <button
        className="select-file-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={isAnalyzing}
      >
        📁 Select Image
      </button>

      {preview && (
        <div className="preview-container">
          <img src={preview} alt="Preview" className="preview-image" />
          <button
            className="analyze-btn"
            onClick={onAnalyze}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? '⏳ Analyzing...' : '🔍 Analyze Image'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
