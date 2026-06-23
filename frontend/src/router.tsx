import { createBrowserRouter, type RouteObject } from 'react-router-dom'

import { Layout } from '@/components/Layout'
import Capture from '@/pages/Capture'
import Progress from '@/pages/Progress'
import Review from '@/pages/Review'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { FloorScan } from '@/floor/FloorScan'
import { FloorCapture } from '@/floor/FloorCapture'

export const routes: RouteObject[] = [
  // Floor camera flow — full-screen mobile, deliberately OUTSIDE <Layout> (no
  // desktop header/nav chrome): the operator scans, captures, and saves hands-on.
  { path: '/floor', element: <FloorScan /> },
  { path: '/floor/capture/:barcode', element: <FloorCapture /> },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Capture /> },
      { path: 'progress', element: <Progress /> },
      { path: 'review', element: <Review /> },
      {
        path: '*',
        element: (
          <PlaceholderPage
            route="404"
            title="Not found"
            note="No page at this route. Use the nav above."
          />
        ),
      },
    ],
  },
]

export const router = createBrowserRouter(routes)
