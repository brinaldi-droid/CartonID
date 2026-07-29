Here's a polished **Figma AI prompt** designed for building a packaging optimization feature. It is product-agnostic, engineering-focused, and written as a product requirements prompt rather than a chatbot instruction.

---

# AI Packaging Optimization Engine

## Objective

Design an AI-powered Packaging Optimization Engine that recommends the optimal shipping configuration for one or more products. The system should emulate the decision-making process of an experienced Packaging Engineer—not just solve a 3D bin-packing problem.

The AI should optimize packaging based on protection, movement prevention, manufacturability, sustainability, shipping efficiency, and cost while minimizing packaging materials.

---

## Core Goals

The AI should prioritize the following objectives in order:

1. Prevent product damage during transportation.
2. Eliminate product movement inside the shipping carton.
3. Minimize dunnage usage.
4. Select the smallest practical shipping carton.
5. Minimize shipping cube and dimensional weight.
6. Maximize packing consistency and ease of assembly.
7. Reduce packaging cost and labor.

The AI should explain trade-offs and recommend the best overall engineering solution rather than optimizing for only one metric.

---

## Product Inputs

Support any number of products.

Each product may include:

* Product Name
* SKU / Product ID
* Length
* Width
* Height
* Weight
* Package Type (Rigid Box, Soft Bag, Pouch, Tray, Case, etc.)
* Shape
* Fragility Rating
* Compression Strength
* Maximum Allowable Top Load
* Stackability
* Preferred Orientations
* Restricted Orientations
* Center of Gravity
* Material Type
* Packaging Tolerances
* Sterility Requirements
* Hazard Classification
* Shipping Restrictions
* Temperature Requirements

---

## Carton Inputs

Support:

* Available standard carton sizes
* Custom carton sizing
* Inside dimensions
* Outside dimensions
* Corrugated grade
* Board strength (ECT/BCT)
* Maximum gross weight
* Manufacturing tolerances
* Shipping carrier limits

---

## Packaging Material Inputs

Allow configurable packaging materials such as:

* Kraft paper
* Bubble wrap
* Foam
* Air pillows
* Corrugated inserts
* Molded pulp

Each material should include:

* Cost
* Sustainability score
* Cushioning performance
* Compression characteristics
* Density
* Recyclability

The system should allow users to enable or disable specific materials. If only one material is permitted (e.g., kraft paper), all recommendations must use only that material.

---

## Engineering Rules

The AI should apply real-world packaging engineering principles.

### Load Distribution

* Heavy products should support lighter products.
* Rigid packages should support rigid packages.
* Flexible or soft packages should not support rigid products.
* Build flat, stable layers whenever possible.
* Avoid point loading.

### Movement Prevention

Eliminate movement in all six directions:

* Left
* Right
* Front
* Back
* Up
* Down

Evaluate:

* Sliding
* Rotation
* Tipping
* Bouncing
* Migration
* Product-to-product contact
* Product-to-carton contact

### Center of Gravity

Optimize for:

* Low center of gravity
* Balanced weight distribution
* Stable load paths

Avoid top-heavy or uneven configurations.

### Void Space

Do not optimize only for carton volume.

Analyze:

* Side voids
* End voids
* Top clearance
* Bottom clearance
* Unsupported areas
* Irregular voids

Smaller controlled voids are preferable to one large uncontrolled void.

### Dunnage Optimization

Use the minimum amount of packaging material required.

Strategically place dunnage to:

* Prevent movement
* Prevent impact
* Protect fragile areas
* Eliminate voids

Avoid excessive fill.

---

## Engineering Analysis

For every solution calculate:

### Damage Risk

Evaluate:

* Compression damage
* Corner damage
* Edge damage
* Impact damage
* Abrasion
* Vibration
* Carton deformation
* Load transfer
* Soft package deformation

### Movement Risk

Evaluate:

* Horizontal movement
* Vertical movement
* Rotation
* Tipping
* Sliding
* Product migration

### Efficiency Metrics

Calculate:

* Carton utilization (%)
* Void percentage
* Dunnage volume
* Estimated dunnage weight
* Gross shipping weight
* Shipping cube
* Dimensional weight
* Packing complexity
* Estimated pack time

---

## Optimization Process

The AI should:

1. Generate multiple feasible packing layouts.
2. Evaluate each layout using engineering rules.
3. Score each configuration.
4. Rank the solutions.
5. Recommend the best overall solution.

Never return only one layout unless no alternatives exist.

---

## Scoring Model

Default weighted scoring:

* Damage Prevention: **35%**
* Movement Prevention: **25%**
* Dunnage Reduction: **15%**
* Carton Size Optimization: **10%**
* Packing Repeatability: **10%**
* Labor Efficiency: **5%**

These weights should be configurable by the user.

---

## Output Requirements

For each recommendation, provide:

### Recommended Carton

* Inside dimensions
* Outside dimensions (if available)
* Corrugated board recommendation
* Estimated shipping cube

### Packing Layout

* Layer-by-layer visualization
* Product orientations
* Weight distribution
* Center of gravity

### Dunnage Plan

* Material used
* Estimated quantity
* Placement locations
* Purpose of each dunnage location

### Engineering Summary

* Movement risk score
* Damage risk score
* Void analysis
* Cube utilization
* Shipping efficiency
* Sustainability assessment
* Manufacturing complexity

### Alternative Solutions

Display the top three ranked packaging options with:

* Overall score
* Advantages
* Disadvantages
* Engineering rationale
* Recommended use case

---

## AI Behavior

The AI should think like a Senior Packaging Engineer, not a simple packing algorithm. Every recommendation should balance protection, manufacturability, sustainability, cost, and shipping efficiency. When trade-offs exist, explain them clearly and prioritize solutions that are robust, repeatable, and likely to perform well in real-world distribution testing (e.g., ISTA/ASTM). The goal is not just to fit products into a box, but to design the best possible packaging system with the least material while maintaining product integrity throughout the supply chain.
