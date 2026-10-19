@smoke @REQ-HEALTH
Feature: Service health
  Scenario: Health API honors the published contract
    Given the SuperQ reference application
    When I execute the approved health test
    Then the health test passes all explicit assertions
