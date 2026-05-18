import {
  legacyItemIdentityWarnings,
  suggestLegacyItemMappingsFromVariants,
} from "../legacy-item-candidate-suggestions"

describe("legacy item candidate identity warnings", () => {
  it("rejects prepared dishes that only share generic serving words", () => {
    const warnings = legacyItemIdentityWarnings(
      "Chicken POT PIE in Puff Pastry, Bake-off and Serve, NOT Kosher for Passover",
      "Beef Chili, Fully Cooked, Serves 4-5 Adults, NOT Kosher for Passover"
    )

    expect(warnings).toContain("protein_species:chicken->beef")
    expect(warnings).toContain("prepared_item:pot_pie->chili")
  })

  it("flags pocket pies with different proteins or fillings", () => {
    expect(
      legacyItemIdentityWarnings(
        "Steak and Vegetable POCKET PIES (5 per box)",
        "Chicken and Vegetable POCKET PIES (5 per box)"
      )
    ).toContain("protein_species:beef->chicken")

    expect(
      legacyItemIdentityWarnings(
        "Steak and Vegetable POCKET PIES (5 per box)",
        "Steak and Mushroom POCKET PIES (5 per box)"
      )
    ).toContain("prepared_filling:vegetable->mushroom")

    expect(
      legacyItemIdentityWarnings(
        "Steak and Vegetable POCKET PIES (5 per box)",
        "Apple Cinnamon POCKET PIES (5 per box)"
      )
    ).toContain("prepared_filling:vegetable->apple_cinnamon")

    expect(
      legacyItemIdentityWarnings(
        "Steak and Vegetable POCKET PIES (5 per box)",
        "Pulled Beef POCKET PIES (5 per box)"
      )
    ).toContain("prepared_meat_form:steak->pulled_beef")
  })

  it("distinguishes turkey pastrami from other sliced turkey deli items", () => {
    expect(
      legacyItemIdentityWarnings(
        "Sliced Turkey Pastrami, Griller's Pride Sliced and Vacuum Packed",
        "Sliced Oven Roasted Turkey Breast, Griller's Pride Sliced and Vacuum Packed"
      )
    ).toContain("deli_preparation:pastrami->roasted_breast")

    expect(
      legacyItemIdentityWarnings(
        "Sliced Turkey Pastrami, Griller's Pride Sliced and Vacuum Packed",
        "Sliced Turkey Bacon"
      )
    ).toContain("deli_preparation:pastrami->bacon")

    expect(
      legacyItemIdentityWarnings(
        "Sliced Turkey Pastrami, Griller's Pride Sliced and Vacuum Packed",
        "Sliced French Roast Pastrami"
      )
    ).toContain("protein_species:turkey->beef")

    expect(
      legacyItemIdentityWarnings(
        "Sliced Turkey Pastrami, Griller's Pride Sliced and Vacuum Packed",
        "Off-cuts: Sliced Turkey Pastrami, Limited Availability"
      ).filter((warning) => warning.startsWith("deli_preparation:"))
    ).toEqual([])
  })

  it("normalizes spacing in important brand and program markers", () => {
    expect(
      legacyItemIdentityWarnings(
        "London Broil Signature Cut American  Angus",
        "London Broil Signature Cut, 100% GRASS FED"
      )
    ).toContain("brand_or_program:american_angus->grass_fed")

    expect(
      legacyItemIdentityWarnings(
        "Strip Steak, American Angus",
        "Strip Steak, South American"
      )
    ).toContain("brand_or_program:american_angus->south_american")
  })

  it("suppresses token-only suggestions with conflicting poultry identities", () => {
    const suggestions = suggestLegacyItemMappingsFromVariants(
      {
        qbd_item_list_id: "800009B3-1498592193",
        sku: "6-01-21-1",
        title: "6-01-21-1",
        sample_description:
          "Chicken 8-pce Cut-up, DAVID ELLIOT, CHK Supervision, Vacuum Packed",
        top_descriptions: [
          {
            description:
              "Chicken 8-pce Cut-up, DAVID ELLIOT, CHK Supervision, Vacuum Packed",
          },
        ],
        description_count: 76,
      },
      [
        {
          variant_id: "variant_cornish_hen",
          product_id: "prod_cornish_hen",
          sku: "6-01-22-4",
          variant_title:
            "Cornish Hen, DAVID ELLIOT, CHK Supervision, Vacuum Packed",
          product_title:
            "Cornish Hen, DAVID ELLIOT, CHK Supervision, Vacuum Packed",
          variant_metadata: null,
          product_metadata: null,
        },
      ],
      { minScore: 0.45 }
    )

    expect(suggestions).toEqual([])
  })
})
