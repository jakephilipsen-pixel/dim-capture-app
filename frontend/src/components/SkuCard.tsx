import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SkuDetail } from '@/lib/api'

export interface SkuCardProps {
  sku: SkuDetail
}

/** Shows the looked-up SKU's name, barcode, and dim status (local + CC). */
export function SkuCard({ sku }: SkuCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg leading-snug">{sku.name}</CardTitle>
        <p className="font-mono text-sm text-muted-foreground">{sku.barcode}</p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {sku.hasDims ? (
          <Badge variant="success">✓ Captured</Badge>
        ) : (
          <Badge variant="secondary">No dims captured</Badge>
        )}
        {sku.ccDimsCaptured ? (
          <Badge variant="outline">Already in CartonCloud</Badge>
        ) : (
          <Badge variant="outline">❌ No dims in CC</Badge>
        )}
      </CardContent>
    </Card>
  )
}
