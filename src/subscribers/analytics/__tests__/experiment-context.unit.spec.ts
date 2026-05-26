import {
  experimentContextFromItem,
  experimentContextFromItems,
} from "../experiment-context"

describe("experiment analytics context", () => {
  it("normalizes experiment context from line-item metadata", () => {
    expect(
      experimentContextFromItem({
        metadata: {
          experiment_context: {
            homepage_shopping_flow_v1: {
              variant_key: "products_earlier",
              assignment_id: "a1",
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
})
