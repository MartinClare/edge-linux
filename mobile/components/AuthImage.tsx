import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ImageResizeMode, ImageStyle, StyleProp, View } from 'react-native';

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function AuthImage({
  uri,
  token,
  style,
  resizeMode = 'cover',
  placeholderColor = '#e5e7eb',
}: {
  uri: string | null;
  token?: string | null;
  style: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  placeholderColor?: string;
}) {
  const [dataUri, setDataUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uri) {
        setDataUri(null);
        return;
      }

      setLoading(true);
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch(uri, { headers });
        if (!res.ok) {
          if (!cancelled) setDataUri(null);
          return;
        }
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        const buffer = await res.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        if (!cancelled) {
          setDataUri(`data:${contentType};base64,${base64}`);
        }
      } catch {
        if (!cancelled) setDataUri(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [uri, token]);

  if (!dataUri) {
    return (
      <View style={[style, { backgroundColor: placeholderColor, alignItems: 'center', justifyContent: 'center' }]}>
        {loading ? <ActivityIndicator /> : null}
      </View>
    );
  }

  return <Image source={{ uri: dataUri }} style={style} resizeMode={resizeMode} />;
}
