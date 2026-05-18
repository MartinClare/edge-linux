import axios from 'axios';
import FormData from 'form-data';

export const YOLO_API_URL = process.env.YOLO_API_URL || 'http://127.0.0.1:8000';

export type YoloDetection = {
  class_id?: number;
  class_name: string;
  confidence: number;
  bbox?: number[];
};

export type YoloImageResult = {
  image_width?: number;
  image_height?: number;
  model_name?: string;
  device?: string;
  inference_ms?: number;
  detections: YoloDetection[];
};

export async function detectImageWithYolo(
  jpegBuffer: Buffer,
  timeoutMs = 15_000,
): Promise<YoloImageResult> {
  const form = new FormData();
  form.append('file', jpegBuffer, {
    filename: 'frame.jpg',
    contentType: 'image/jpeg',
  });

  const res = await axios.post<YoloImageResult>(
    `${YOLO_API_URL.replace(/\/$/, '')}/detect/image`,
    form,
    {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: timeoutMs,
    },
  );

  return {
    ...res.data,
    detections: Array.isArray(res.data?.detections) ? res.data.detections : [],
  };
}
