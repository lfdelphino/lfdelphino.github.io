import pandas as pd

# Load the spreadsheet data
# Replace 'your_spreadsheet.xlsx' with your actual file path
df = pd.read_excel('plot_occupancy.xlsx')

# Define the number of days in each month
days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

# Function to calculate annual occupancy rate
def calculate_annual_occupancy(row):
    total_booked_days = 0
    total_available_days = 0
    for month, days in zip(row[1:], days_in_month):
        if month > 0:
            total_booked_days += month / 100 * days
            total_available_days += days
    return (total_booked_days / total_available_days) * 100 if total_available_days > 0 else 0

# Apply the function to each row
df['Annual Occupancy Rate'] = df.apply(calculate_annual_occupancy, axis=1)

# Now df has an additional column with the annual occupancy rate
print(df)
