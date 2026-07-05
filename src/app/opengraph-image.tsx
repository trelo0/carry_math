import { ImageResponse } from "next/og";
import { getSiteMetaContent } from "@/lib/siteMetadata";

export const alt = "Math Future — онлайн школа математики";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function truncate(text: string, maxLength: number) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

export default async function OpenGraphImage() {
  const { siteName, description } = await getSiteMetaContent();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #faf7f3 0%, #f3ece4 100%)",
          color: "#403833",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.1,
            marginBottom: 28,
          }}
        >
          {siteName}
        </div>
        <div
          style={{
            fontSize: 34,
            lineHeight: 1.4,
            color: "#72675e",
            maxWidth: 900,
          }}
        >
          {truncate(description, 140)}
        </div>
      </div>
    ),
    size,
  );
}
