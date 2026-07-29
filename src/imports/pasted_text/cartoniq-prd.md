Product Requirements Document (PRD)
Product Name

CartonIQ – AI Carton Selection Optimization Agent

1. Executive Summary

CartonIQ is a standalone AI-assisted decision-support prototype designed to improve carton selection decisions within medical device distribution center operations. The system enhances traditional warehouse management system (WMS) cartonization logic by using predictive scoring and operational analytics to recommend the most cost-effective and protective carton for customer orders.

The MVP will compare the current Manhattan WMS carton recommendation against an AI-generated recommendation using factors such as:

carton utilization,
dimensional weight,
shipping cost estimation,
product fragility,
and sustainability impact.

The system is intended for supply chain analysts, distribution engineers, and pack station operators and will demonstrate practical operational improvements through a live demo within an 8-week MVP timeline.

2. Problem Statement

Current warehouse management systems rely primarily on static rule-based cartonization logic when selecting shipping cartons. While these systems optimize dimensional fit, they may not fully optimize:

shipping cost,
carton utilization,
packaging waste,
dimensional weight charges,
or product protection.

This can lead to:

oversized cartons,
increased freight costs,
poor carton utilization,
excess corrugate usage,
and reduced packaging efficiency.

The opportunity exists to augment existing WMS logic with predictive analytics and explainable AI recommendations that improve operational decision-making while maintaining safe packaging standards for medical device products.

3. Product Vision

To create a practical AI-powered recommendation engine that improves carton selection decisions in medical device distribution centers by balancing shipping cost, carton utilization, and product protection.

4. Product Goals
Primary Goals
Reduce estimated shipping cost
Improve carton utilization
Reduce dimensional weight impact
Improve packaging efficiency
Maintain safe packaging standards
Secondary Goals
Demonstrate practical AI-assisted operations optimization
Provide explainable recommendation rationale
Support sustainability improvements
Create a scalable prototype architecture
5. Non-Goals (Out of Scope)

The MVP will NOT include:

live Manhattan WMS integration,
production deployment,
automated machine learning retraining,
real carrier API integrations,
cold-chain/hazardous goods optimization,
full warehouse optimization,
real-time enterprise deployment.
6. Target Users
User	Responsibilities
Supply Chain Analysts	Analyze carton utilization and cost savings
Distribution Engineers	Evaluate operational optimization opportunities
Pack Station Operators	Review carton recommendations during fulfillment
7. Core User Workflow
Workflow
User scans SKU barcode
System retrieves SKU data from Excel-based SKU database
User adds quantity and additional SKUs to order
System displays Manhattan carton recommendation
AI agent evaluates:
carton utilization
dimensional weight
estimated shipping cost
fragility multiplier
sustainability impact
System recommends optimized carton
Dashboard displays:
Manhattan recommendation
AI recommendation
estimated savings
rationale
optimization score
8. MVP Features
Core Features
8.1 SKU Barcode Scan
Barcode input support
Auto-populate:
SKU dimensions
weight
fragility level
8.2 Multi-SKU Order Builder

Users can:

add multiple SKUs,
update quantities,
remove SKUs from order.
8.3 Carton Recommendation Engine

System evaluates predefined carton sizes and selects:

best overall carton option.

Supported cartons:

Small
Medium
Large
XL
configurable future expansion
8.4 Manhattan vs AI Comparison

Display:

current Manhattan carton recommendation,
AI recommended carton,
optimization comparison.
8.5 Predictive Optimization Score

AI recommendation score based on:

shipping cost efficiency,
carton utilization,
dimensional weight,
fragility protection,
sustainability impact.
8.6 Recommendation Rationale

System automatically generates business explanation:

Example:

“AI selected Box 3 because it reduced dimensional weight by 18% while maintaining acceptable protection thresholds and improving carton utilization.”

8.7 Dashboard Analytics

Display:

estimated shipping savings,
estimated corrugate reduction,
carton utilization percentage,
sustainability score,
dimensional weight impact.
8.8 Admin Panel

Admins can:

add/edit cartons,
add/edit SKUs,
import SKU database via Excel,
update carton dimensions.
9. Recommendation Engine Logic
Inputs
SKU dimensions
SKU weight
Fragility level
Manhattan carton recommendation
Carton dimensions
Order quantity
Multi-SKU order volume
Optimization Factors
Factor	Purpose
Carton Utilization	Reduce empty space
Dimensional Weight	Reduce freight cost
Fragility Multiplier	Ensure protection
Shipping Cost Estimate	Optimize cost
Sustainability Score	Reduce packaging waste
Optimization Goal

Select the carton with the highest overall optimization score while maintaining safe packaging requirements.

10. Fragility Scoring
Fragility Level	Multiplier
Low	1.0
Medium	1.2
High	1.5

Higher fragility products require:

increased protection threshold,
reduced utilization tolerance.
11. Functional Requirements
ID	Requirement
FR-1	User can scan SKU barcode
FR-2	System retrieves SKU data from Excel database
FR-3	User can build multi-SKU orders
FR-4	System compares Manhattan vs AI carton recommendations
FR-5	System calculates dimensional weight
FR-6	System calculates optimization score
FR-7	System displays rationale for recommendation
FR-8	Admin can manage cartons
FR-9	Admin can manage SKU database
FR-10	Dashboard displays estimated savings metrics
12. Non-Functional Requirements
Category	Requirement
Performance	Recommendation generated under 3 seconds
Usability	Simple dashboard-style UI
Reliability	Recommendations consistent across identical inputs
Explainability	AI rationale visible to user
Scalability	Additional carton sizes supported
13. UX Requirements
Main Screens
Login/Home
Order Builder
Carton Recommendation Dashboard
Admin Panel
Analytics Dashboard
Dashboard Components
Manhattan Recommendation Card
AI Recommendation Card
Optimization Score
Cost Savings Card
Sustainability Card
Recommendation Rationale
14. Data Sources
Initial Data Source

Excel-based SKU database containing:

SKU ID
dimensions
weight
fragility level
15. Technical Architecture
Layer	Technology
Frontend	Google Stitch
Recommendation Logic	Rules-based predictive scoring
Data Storage	Excel import / local structured dataset
Barcode Input	Scanner-compatible input field
Analytics	Client-side calculations
16. KPIs / Success Metrics
MVP Success Metrics
estimated reduction in shipping cost,
improved carton utilization,
reduced dimensional weight,
estimated corrugate reduction,
successful live demo.
17. Risks & Assumptions
Risks
limited carrier pricing data,
simplified cartonization logic,
limited historical shipment data,
simulated cost assumptions.
Assumptions
SKU dimensions are accurate,
predefined cartons are sufficient,
Manhattan recommendations available for comparison.
18. Future Enhancements
Phase 2 Opportunities
live Manhattan integration,
machine learning model training,
carrier API integration,
real shipment analytics,
operator feedback loop,
automated learning,
sustainability reporting.
19. 8-Week MVP Roadmap
Week	Deliverable
Week 1	Finalize requirements and UX wireframes
Week 2	Build SKU database structure and barcode workflow
Week 3	Build order builder and carton logic
Week 4	Implement optimization scoring engine
Week 5	Build Manhattan vs AI comparison dashboard
Week 6	Add rationale generation and analytics
Week 7	Admin panel, testing, and refinement
Week 8	Demo preparation and presentation
20. Live Demo Scenario
Demo Flow
User scans multiple SKUs
System loads product dimensions and weights
Manhattan recommendation displayed
AI recommendation generated
Dashboard compares:
cost,
utilization,
dimensional weight,
sustainability
AI rationale displayed
Estimated savings shown
21. Expected Business Value

If implemented at scale, CartonIQ could potentially:

reduce freight costs,
improve carton utilization,
reduce corrugate waste,
improve packaging consistency,
support sustainability initiatives,
and enhance operational decision-making within medical device distribution centers