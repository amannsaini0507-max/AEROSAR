import os
from glob import glob
from setuptools import find_packages, setup

package_name = 'aerosar_sim'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', glob('launch/*.py')),
        ('share/' + package_name + '/worlds', glob('worlds/*.wbt')),
        ('share/' + package_name + '/resource', glob('resource/*')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='saksh',
    maintainer_email='amann.saini.0507@gmail.com',
    description='AEROSAR Webots Simulation and Drone ROS 2 Driver',
    license='MIT',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
        ],
    },
)
