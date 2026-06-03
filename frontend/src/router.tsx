import { createBrowserRouter, type RouteObject } from 'react-router-dom'

import { Layout } from '@/components/Layout'
import Capture from '@/pages/Capture'
import Progress from '@/pages/Progress'
import Review from '@/pages/Review'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

export const routes: RouteObject[] = [
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
