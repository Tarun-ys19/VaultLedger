import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function initials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}

export const DEMO_EMAIL_DOMAIN = 'demo.neobank.invalid'

export function displayAccountName(email: string): string {
  return email.endsWith(`@${DEMO_EMAIL_DOMAIN}`) ? 'Demo account' : email
}
