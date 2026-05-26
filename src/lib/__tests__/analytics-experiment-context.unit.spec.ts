import {
  experimentContextFromItem,
  experimentContextFromItems,
  experimentIdentityFromItems,
} from "../analytics/experiment-context"

describe("experiment analytics context", () => {
  it("normalizes experiment context from line-item metadata", () => {
    expect(
      experimentContextFromItem({
        metadata: {
          experiment_context: {
            homepage_shopping_flow_v1: {
              variant_key: "products_earlier",
              assignment_id: "a1",
              surface: "homepage",
              impact: "revenue",
              route_market: "us",
              customer_type: "guest",
              anonymous_id: "anon-1",
              session_id: "session-1",
            },
            malformed: {
              variant_key: "control",
            },
          },
        },
      })
    ).toEqual({
      homepage_shopping_flow_v1: {
        variant_key: "products_earlier",
        assignment_id: "a1",
        surface: "homepage",
        impact: "revenue",
        route_market: "us",
        customer_type: "guest",
        anonymous_id: "anon-1",
        session_id: "session-1",
      },
    })
  })

  it("merges context across order items", () => {
    expect(
      experimentContextFromItems([
        {
          metadata: {
            experiment_context: JSON.stringify({
              homepage_shopping_flow_v1: {
                variant_key: "products_earlier",
                assignment_id: "a1",
              },
            }),
          },
        },
        {
          metadata: {
            experiment_context: {
              pdp_at_a_glance_v1: {
                variant_key: "collapsed_details",
                assignment_id: "a2",
              },
            },
          },
        },
      ])
    ).toEqual({
      homepage_shopping_flow_v1: {
        variant_key: "products_earlier",
        assignment_id: "a1",
      },
      pdp_at_a_glance_v1: {
        variant_key: "collapsed_details",
        assignment_id: "a2",
      },
    })
  })

  it("returns undefined when there is no valid context", () => {
    expect(experimentContextFromItems([{ metadata: {} }])).toBeUndefined()
  })

  it("lifts event identity from experiment line metadata", () => {
    expect(
      experimentIdentityFromItems([
        {
          metadata: {
            experiment_context: {
              homepage_shopping_flow_v1: {
                variant_key: "products_earlier",
                assignment_id: "a1",
                anonymous_id: "anon-1",
                session_id: "session-1",
                route_market: "us",
                customer_type: "guest",
              },
            },
          },
        },
      ])
    ).toEqual({
      anonymous_id: "anon-1",
      session_id: "session-1",
      route_market: "us",
      customer_type: "guest",
    })
  })
})
