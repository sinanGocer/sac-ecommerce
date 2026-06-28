export const getBaseURL = () => {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim()
  const fallback = "http://localhost:8000"

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "NEXT_PUBLIC_BASE_URL is not set. Falling back to http://localhost:8000 for canonical URLs."
      )
    }

    return fallback
  }

  const url = new URL(configured)

  if (isLocalHost(url.hostname)) {
    url.protocol = "http:"
  } else if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_BASE_URL must use HTTPS in production.")
  }

  return url.toString().replace(/\/$/, "")
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
}
