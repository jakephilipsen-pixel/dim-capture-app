import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'

export interface PlaceholderPageProps {
  route: string
  title: string
  note: string
}

/**
 * Shell-only placeholder. Names the route so navigation is verifiable; the
 * real page implementation arrives in modules 06/07.
 */
export function PlaceholderPage({ route, title, note }: PlaceholderPageProps) {
  return (
    <Card>
      <CardHeader>
        <h1 className="text-xl font-semibold leading-none tracking-tight">{title}</h1>
        <CardDescription>
          Route <code className="rounded bg-muted px-1 py-0.5 text-xs">{route}</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  )
}
