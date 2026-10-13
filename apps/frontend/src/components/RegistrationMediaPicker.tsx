'use client';

import { useEffect, useState } from 'react';
import { Button, Image, Upload } from 'antd';
import { CameraCaptureButton } from './CameraCaptureButton';

export function RegistrationMediaPicker({ value, onChange, allowPdf = true }: {
  value?: File;
  onChange?: (file?: File) => void;
  allowPdf?: boolean;
}) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!value?.type.startsWith('image/')) { setPreview(undefined); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);
  return <div className="registration-document-picker">
    {preview && <div className={`registration-document-preview${allowPdf ? '' : ' is-portrait'}`}>
      <Image src={preview} alt={allowPdf ? 'Giấy tờ đã chọn' : 'Ảnh thẻ đã chọn'} className="registration-document-image" />
    </div>}
    {value && <p className="mb-3 break-all text-sm">{value.name}</p>}
    <div className="flex flex-wrap gap-2">
      <Upload accept={`image/jpeg,image/png,image/webp${allowPdf ? ',application/pdf' : ''}`} maxCount={1} showUploadList={false}
        beforeUpload={(file) => { onChange?.(file); return false; }}>
        <Button>{value ? 'Thay tệp' : allowPdf ? 'Chọn ảnh / PDF' : 'Chọn ảnh thẻ'}</Button>
      </Upload>
      <CameraCaptureButton label={allowPdf ? 'Chụp giấy tờ' : 'Chụp ảnh thẻ'} facingMode={allowPdf ? 'environment' : 'user'} onCapture={(file) => onChange?.(file)} />
      {value && <Button danger onClick={() => onChange?.(undefined)}>Xóa</Button>}
    </div>
  </div>;
}
