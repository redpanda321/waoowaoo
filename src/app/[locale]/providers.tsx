'use client'

import { SessionProvider } from "next-auth/react"
import { ToastProvider } from "@/contexts/ToastContext"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { HanggentAuthBridge } from "@/components/auth/HanggentAuthBridge"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchOnWindowFocus={false}
      refetchInterval={0}
    >
      <QueryProvider>
        <ToastProvider>
          <HanggentAuthBridge />
          {children}
        </ToastProvider>
      </QueryProvider>
    </SessionProvider>
  )
}
